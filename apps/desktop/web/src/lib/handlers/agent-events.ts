import type { AgentEvent, ContentBlock } from "$lib/types/agent";
import type { AgentStore } from "$lib/stores/agent.svelte";
import type { MessagesStore } from "$lib/stores/messages.svelte";

export interface SessionRuntimeForEvents {
  agent: AgentStore;
  messages: MessagesStore;
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
}

export function handleAgentEnd(runtime: SessionRuntimeForEvents): void {
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

  // Apply delta with in-place mutation
  // Svelte 5's fine-grained reactivity will detect mutations to the content
  // array and its elements, triggering only the affected component to re-render
  applyAssistantMessageDelta(currentContent, event.assistantMessageEvent);
}

export function handleMessageEnd(
  runtime: SessionRuntimeForEvents,
  event: Extract<AgentEvent, { type: "message_end" }>,
): void {
  if (event.message.role === "assistant") {
    const content = runtime.messages.convertAssistantContent(
      event.message.content,
    );
    const errorMessage = extractAssistantErrorMessage(event.message);
    const resolvedContent =
      content.length > 0
        ? content
        : errorMessage
          ? ([
              { type: "text" as const, text: `Error: ${errorMessage}` },
            ] as const)
          : [];

    const streamingId = runtime.messages.streamingMessageId;
    const hasStreamingMessage =
      !!streamingId &&
      runtime.messages.messages.some((m) => m.id === streamingId);

    if (resolvedContent.length > 0) {
      if (!hasStreamingMessage) {
        runtime.messages.createStreamingMessage();
      }

      runtime.messages.updateStreamingMessage([...resolvedContent]);
    }
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
  }
}
