import type { AgentEvent, ContentBlock } from "$lib/types/agent";
import type { AgentStore } from "$lib/stores/agent.svelte";
import type { MessagesStore } from "$lib/stores/messages.svelte";

export interface SessionRuntimeForEvents {
  agent: AgentStore;
  messages: MessagesStore;
}

// Performance: Batch streaming deltas to reduce re-renders.
// Instead of triggering Svelte reactivity on every character, we collect
// deltas and apply them once per animation frame (~16ms max).
// This reduces re-renders from potentially 100+ per second to at most 60fps.

interface PendingDelta {
  contentIndex: number;
  delta: string;
  type: "text" | "thinking";
}

interface StreamingBatcher {
  pendingDeltas: PendingDelta[];
  rafId: number | null;
  content: ContentBlock[];
  flush: () => void;
}

const batchers = new Map<string, StreamingBatcher>();

function getOrCreateBatcher(
  sessionId: string,
  content: ContentBlock[],
): StreamingBatcher {
  let batcher = batchers.get(sessionId);
  if (!batcher) {
    batcher = {
      pendingDeltas: [],
      rafId: null,
      content,
      flush: () => flushBatcher(sessionId),
    };
    batchers.set(sessionId, batcher);
  } else {
    // Update content reference (it may have changed)
    batcher.content = content;
  }
  return batcher;
}

function flushBatcher(sessionId: string): void {
  const batcher = batchers.get(sessionId);
  if (!batcher) return;

  // Clear RAF id first so we don't cancel it after
  batcher.rafId = null;

  if (batcher.pendingDeltas.length === 0) return;

  // Apply all pending deltas directly to the content array
  for (const pending of batcher.pendingDeltas) {
    const block = batcher.content[pending.contentIndex];
    if (pending.type === "text" && block?.type === "text") {
      block.text += pending.delta;
    } else if (pending.type === "thinking" && block?.type === "thinking") {
      block.thinking += pending.delta;
    }
  }

  // Clear pending deltas
  batcher.pendingDeltas = [];

  // Commit the updated content reference without cloning to avoid
  // extra array churn during high-frequency streaming.
  const runtime = activeRuntimes.get(sessionId);
  if (runtime) {
    runtime.messages.updateStreamingMessage(batcher.content);
  }
}

// Track active runtimes for flushing
const activeRuntimes = new Map<string, SessionRuntimeForEvents>();

function scheduleBatchFlush(
  sessionId: string,
  batcher: StreamingBatcher,
): void {
  if (batcher.rafId === null) {
    batcher.rafId = requestAnimationFrame(() => flushBatcher(sessionId));
  }
}

function clearBatcher(sessionId: string): void {
  const batcher = batchers.get(sessionId);
  if (batcher) {
    if (batcher.rafId !== null) {
      cancelAnimationFrame(batcher.rafId);
    }
    batchers.delete(sessionId);
  }
  activeRuntimes.delete(sessionId);
}

function extractAssistantErrorMessage(message: {
  [key: string]: unknown;
}): string | null {
  if (
    typeof message.errorMessage === "string" &&
    message.errorMessage.trim().length > 0
  ) {
    return message.errorMessage.trim();
  }

  if (message.stopReason === "error") {
    return "The model request failed. Check provider authentication and model settings.";
  }

  return null;
}

// Event handlers for agent events
export function handleAgentStart(runtime: SessionRuntimeForEvents): void {
  runtime.agent.setLoading(true);
  // Register runtime for batcher access
  activeRuntimes.set(runtime.agent.sessionId, runtime);
}

export function handleAgentEnd(runtime: SessionRuntimeForEvents): void {
  const sessionId = runtime.agent.sessionId;
  // Flush any remaining deltas before finalizing
  const batcher = batchers.get(sessionId);
  if (batcher && batcher.pendingDeltas.length > 0) {
    flushBatcher(sessionId);
  }
  clearBatcher(sessionId);
  runtime.agent.setLoading(false);
  runtime.messages.finalizeStreamingMessage();
  runtime.agent.refreshState().catch((error) => {
    console.warn("Failed to refresh agent state:", error);
  });
}

export function handleMessageStart(
  runtime: SessionRuntimeForEvents,
  event: Extract<AgentEvent, { type: "message_start" }>,
): void {
  if (event.message.role === "user") {
    runtime.messages.addUserMessage(event.message);
    return;
  }

  // Fallback path: toolResult messages contain the same payload as tool_execution_end
  // and can be used to attach results if a tool_execution event was dropped.
  if (event.message.role === "toolResult") {
    const toolCallId =
      typeof event.message.toolCallId === "string"
        ? event.message.toolCallId
        : null;
    if (!toolCallId) return;

    runtime.messages.updateToolCallResult(
      toolCallId,
      formatToolResult(event.message.content),
      event.message.isError === true,
    );
  }
}

// Performance: Mutate content blocks in-place instead of creating new arrays.
// For delta events (text_delta, thinking_delta), this avoids O(n) array copies
// on every character chunk during streaming.

/**
 * Ensure the content array has enough slots for the given index.
 * Mutates the array in-place.
 */
function ensureContentIndex(content: ContentBlock[], index: number): void {
  while (content.length <= index) {
    content.push({ type: "text", text: "" });
  }
}

/**
 * Apply a message delta to the content array.
 * Mutates the content array in-place for optimal performance.
 * Returns true if content was modified, false otherwise.
 */
function applyAssistantMessageDelta(
  content: ContentBlock[],
  assistantEvent: Extract<
    AgentEvent,
    { type: "message_update" }
  >["assistantMessageEvent"],
): boolean {
  const index = assistantEvent.contentIndex;
  if (typeof index !== "number") {
    return false;
  }

  switch (assistantEvent.type) {
    case "text_start":
      ensureContentIndex(content, index);
      content[index] = { type: "text", text: "" };
      return true;

    case "text_delta": {
      ensureContentIndex(content, index);
      const block = content[index];
      if (block?.type === "text") {
        // Direct mutation - no new object
        block.text += assistantEvent.delta ?? "";
        return true;
      }
      // Fallback: create new block if not text
      content[index] = {
        type: "text",
        text: assistantEvent.delta ?? "",
      };
      return true;
    }

    case "text_end": {
      ensureContentIndex(content, index);
      content[index] = { type: "text", text: assistantEvent.content ?? "" };
      return true;
    }

    case "thinking_start":
      ensureContentIndex(content, index);
      content[index] = { type: "thinking", thinking: "" };
      return true;

    case "thinking_delta": {
      ensureContentIndex(content, index);
      const block = content[index];
      if (block?.type === "thinking") {
        // Direct mutation - no new object
        block.thinking += assistantEvent.delta ?? "";
        return true;
      }
      // Fallback: create new block if not thinking
      content[index] = {
        type: "thinking",
        thinking: assistantEvent.delta ?? "",
      };
      return true;
    }

    case "thinking_end": {
      ensureContentIndex(content, index);
      content[index] = {
        type: "thinking",
        thinking: assistantEvent.content ?? assistantEvent.thinking ?? "",
      };
      return true;
    }

    case "toolcall_end": {
      if (!assistantEvent.toolCall) {
        return false;
      }
      ensureContentIndex(content, index);
      content[index] = assistantEvent.toolCall;
      return true;
    }

    // For toolcall_start/toolcall_delta we wait for toolcall_end (full object).
    default:
      return false;
  }
}

export function handleMessageUpdate(
  runtime: SessionRuntimeForEvents,
  event: Extract<AgentEvent, { type: "message_update" }>,
): void {
  if (event.message.role !== "assistant") return;

  const streamingId = runtime.messages.streamingMessageId;
  const hasStreamingMessage =
    !!streamingId &&
    runtime.messages.messages.some((m) => m.id === streamingId);

  // Create streaming message if needed - must happen before we get the content
  if (!hasStreamingMessage) {
    runtime.messages.createStreamingMessage();
  }

  // Get the streaming message's content array for in-place mutation
  const currentMessage = runtime.messages.messages.find(
    (m) => m.id === runtime.messages.streamingMessageId,
  );
  const currentContent =
    currentMessage?.type === "assistant" ? currentMessage.content : [];

  const assistantEvent = event.assistantMessageEvent;
  const index = assistantEvent.contentIndex;
  if (typeof index !== "number") return;

  // Batch text_delta and thinking_delta to reduce re-renders
  if (
    assistantEvent.type === "text_delta" ||
    assistantEvent.type === "thinking_delta"
  ) {
    const sessionId = runtime.agent.sessionId;
    const batcher = getOrCreateBatcher(sessionId, currentContent);

    // Ensure the block exists
    ensureContentIndex(currentContent, index);
    const block = currentContent[index];

    // Initialize block if needed
    if (assistantEvent.type === "text_delta") {
      if (block?.type !== "text") {
        currentContent[index] = { type: "text", text: "" };
      }
    } else {
      if (block?.type !== "thinking") {
        currentContent[index] = { type: "thinking", thinking: "" };
      }
    }

    // Queue delta for batched application
    batcher.pendingDeltas.push({
      contentIndex: index,
      delta: assistantEvent.delta ?? "",
      type: assistantEvent.type === "text_delta" ? "text" : "thinking",
    });

    scheduleBatchFlush(sessionId, batcher);
    return;
  }

  // For non-delta events, flush any pending deltas first, then apply immediately
  const sessionId = runtime.agent.sessionId;
  const batcher = batchers.get(sessionId);
  if (batcher && batcher.pendingDeltas.length > 0) {
    flushBatcher(sessionId);
  }

  // Apply other events immediately (text_start, text_end, thinking_start, thinking_end, toolcall_end)
  applyAssistantMessageDelta(currentContent, assistantEvent);
}

export function handleMessageEnd(
  runtime: SessionRuntimeForEvents,
  event: Extract<AgentEvent, { type: "message_end" }>,
): void {
  if (event.message.role === "assistant") {
    // Flush any pending deltas before replacing with final content
    const sessionId = runtime.agent.sessionId;
    const batcher = batchers.get(sessionId);
    if (batcher) {
      // Clear pending deltas without applying - message_end has complete content
      batcher.pendingDeltas = [];
      if (batcher.rafId !== null) {
        cancelAnimationFrame(batcher.rafId);
        batcher.rafId = null;
      }
    }

    const content = runtime.messages.convertAssistantContent(
      event.message.content,
    );
    const errorMessage = extractAssistantErrorMessage(event.message);
    const resolvedContent =
      content.length > 0
        ? content
        : errorMessage
          ? [{ type: "text" as const, text: `Error: ${errorMessage}` }]
          : [];

    const streamingId = runtime.messages.streamingMessageId;
    const hasStreamingMessage =
      !!streamingId &&
      runtime.messages.messages.some((m) => m.id === streamingId);

    if (resolvedContent.length > 0) {
      if (!hasStreamingMessage) {
        runtime.messages.createStreamingMessage();
      }

      runtime.messages.updateStreamingMessage(resolvedContent);
    }

    runtime.agent.refreshState().catch((error) => {
      console.warn(
        "Failed to refresh agent state after assistant message:",
        error,
      );
    });
  }

  runtime.messages.finalizeStreamingMessage();
}

export function handleTurnEnd(runtime: SessionRuntimeForEvents): void {
  runtime.messages.finalizeStreamingMessage();
}

/**
 * Convert tool result to a displayable string.
 * Handles various result types (string, object, array, etc.)
 */
function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) {
    return "";
  }

  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "object") {
    // Handle content array format from pi-mono AgentToolResult
    if (Array.isArray(result)) {
      const textParts: string[] = [];
      for (const block of result) {
        if (typeof block === "string") {
          textParts.push(block);
        } else if (block && typeof block === "object") {
          const typedBlock = block as { type?: string; text?: string };
          if (
            typedBlock.type === "text" &&
            typeof typedBlock.text === "string"
          ) {
            textParts.push(typedBlock.text);
          }
        }
      }
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }

    // Handle { content: [...] } format
    const obj = result as { content?: unknown; details?: unknown };
    if (obj.content && Array.isArray(obj.content)) {
      const textParts: string[] = [];
      for (const block of obj.content) {
        if (typeof block === "string") {
          textParts.push(block);
        } else if (block && typeof block === "object") {
          const typedBlock = block as { type?: string; text?: string };
          if (
            typedBlock.type === "text" &&
            typeof typedBlock.text === "string"
          ) {
            textParts.push(typedBlock.text);
          }
        }
      }
      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }

    // Fallback to JSON
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return "[Unable to display result]";
    }
  }

  return String(result);
}

export function handleToolExecutionEnd(
  runtime: SessionRuntimeForEvents,
  event: Extract<AgentEvent, { type: "tool_execution_end" }>,
): void {
  runtime.messages.updateToolCallResult(
    event.toolCallId,
    formatToolResult(event.result),
    event.isError,
  );
}

// Main event router
export function handleAgentEvent(
  runtime: SessionRuntimeForEvents,
  event: AgentEvent,
): void {
  switch (event.type) {
    case "agent_start":
      handleAgentStart(runtime);
      break;

    case "agent_end":
      handleAgentEnd(runtime);
      break;

    case "turn_start":
      // Turn is starting - a new message will be created on first message_update
      break;

    case "message_start":
      handleMessageStart(runtime, event);
      break;

    case "message_update":
      handleMessageUpdate(runtime, event);
      break;

    case "message_end":
      handleMessageEnd(runtime, event);
      break;

    case "turn_end":
      handleTurnEnd(runtime);
      break;

    case "tool_execution_end":
      handleToolExecutionEnd(runtime, event);
      break;

    case "auto_compaction_start":
      break;

    case "auto_compaction_end":
      runtime.agent.refreshState().catch((error) => {
        console.warn("Failed to refresh agent state after compaction:", error);
      });
      break;

    case "auto_retry_start":
      break;

    case "auto_retry_end":
      break;
  }
}
