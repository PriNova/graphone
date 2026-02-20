import type {
  ContentBlock,
  Message,
  PromptImageAttachment,
  UserContentBlock,
} from "$lib/types/agent";

// Messages store manages message state and scroll behavior (session-scoped)
export class MessagesStore {
  messages = $state<Message[]>([]);
  streamingMessageId = $state<string | null>(null);

  // Optimistic user-message rendering (important for large attachment payloads,
  // where remote echo events may be delayed or dropped by the platform IPC layer).
  private static readonly OPTIMISTIC_DEDUPE_WINDOW_MS = 15_000;

  // Scroll pinning state is intentionally non-reactive to avoid rerenders
  // during high-frequency scroll events.
  private isUserPinnedToBottom = true;
  private isProgrammaticScroll = false;
  private static readonly SCROLL_EPSILON_PX = 24;

  // Out-of-order safety: tool results can arrive before we have rendered the
  // corresponding toolCall block (e.g. dropped/delayed toolcall_end event).
  private pendingToolResultsById = new Map<
    string,
    { result: string; isError: boolean }
  >();

  // Scroll tracking
  updateScrollPosition(container: HTMLDivElement): void {
    // Ignore scroll events caused by our own scrollToBottom calls.
    if (this.isProgrammaticScroll) {
      return;
    }

    const { scrollTop, scrollHeight, clientHeight } = container;
    this.isUserPinnedToBottom =
      scrollHeight - scrollTop - clientHeight <=
      MessagesStore.SCROLL_EPSILON_PX;
  }

  scrollToBottom(container: HTMLDivElement | null, smooth = true): void {
    if (!container || !this.isUserPinnedToBottom) {
      return;
    }

    this.isProgrammaticScroll = true;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });

    // Release suppression in next frame and refresh pin state once.
    requestAnimationFrame(() => {
      this.isProgrammaticScroll = false;
      this.updateScrollPosition(container);
    });
  }

  // Message management
  addMessage(message: Message): void {
    this.messages = [...this.messages, message];
  }

  clearMessages(): void {
    this.messages = [];
    this.pendingToolResultsById.clear();
  }

  setStreamingMessageId(id: string | null): void {
    this.streamingMessageId = id;
  }

  // Convert agent messages from backend to our Message format.
  // Tool results are stored as separate messages in pi; we merge them back into
  // assistant toolCall blocks by toolCallId so the UI can render inline results.
  loadFromAgentMessages(
    agentMessages: Array<{
      role: string;
      content: unknown;
      timestamp?: number;
      [key: string]: unknown;
    }>,
  ): void {
    this.pendingToolResultsById.clear();
    const loadedMessages: Message[] = [];

    const toolResultsByCallId = new Map<
      string,
      { result: string; isError: boolean }
    >();
    for (const msg of agentMessages) {
      if (msg.role !== "toolResult") continue;

      const toolCallId =
        typeof msg.toolCallId === "string" ? msg.toolCallId : null;
      if (!toolCallId) continue;

      toolResultsByCallId.set(toolCallId, {
        result: MessagesStore.formatToolResultContent(msg.content),
        isError: msg.isError === true,
      });
    }

    for (const msg of agentMessages) {
      const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();

      if (msg.role === "user") {
        loadedMessages.push({
          id: crypto.randomUUID(),
          type: "user",
          content: this.convertUserContent(msg.content),
          timestamp,
        });
        continue;
      }

      if (msg.role === "assistant") {
        const content = this.convertAssistantContent(msg.content).map(
          (block) => {
            if (block.type !== "toolCall") return block;

            const toolResult = toolResultsByCallId.get(block.id);
            if (!toolResult) return block;

            return {
              ...block,
              result: toolResult.result,
              isError: toolResult.isError,
            };
          },
        );

        loadedMessages.push({
          id: crypto.randomUUID(),
          type: "assistant",
          content,
          timestamp,
          isStreaming: false,
        });
      }
    }

    this.messages = loadedMessages;
  }

  addOptimisticUserMessage(content: UserContentBlock[]): void {
    if (content.length === 0) {
      return;
    }

    this.addMessage({
      id: crypto.randomUUID(),
      type: "user",
      content,
      timestamp: new Date(),
    });
  }

  // Add user message from agent event
  addUserMessage(msg: { content?: unknown; timestamp?: number }): void {
    const converted = this.convertUserContent(msg.content);
    const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();

    const last = this.messages[this.messages.length - 1];
    if (
      last?.type === "user" &&
      this.isSameUserContent(last.content, converted) &&
      Math.abs(timestamp.getTime() - last.timestamp.getTime()) <=
        MessagesStore.OPTIMISTIC_DEDUPE_WINDOW_MS
    ) {
      return;
    }

    this.addMessage({
      id: crypto.randomUUID(),
      type: "user",
      content: converted,
      timestamp,
    });
  }

  // Create new streaming assistant message
  createStreamingMessage(): string {
    const id = crypto.randomUUID();
    this.streamingMessageId = id;
    this.addMessage({
      id,
      type: "assistant",
      content: [],
      timestamp: new Date(),
      isStreaming: true,
    });
    return id;
  }

  // Update streaming message content
  // Performance: Direct property mutation instead of array recreation.
  // This leverages Svelte 5's fine-grained reactivity to only re-render
  // the affected message component, not the entire message list.
  updateStreamingMessage(content: ContentBlock[]): void {
    const targetId = this.streamingMessageId;
    if (!targetId) return;

    const message = this.messages.find(
      (m) => m.id === targetId && m.type === "assistant",
    );
    if (message) {
      message.content = content;
    }
  }

  // Finalize streaming message
  // Performance: Direct property mutation instead of array recreation.
  finalizeStreamingMessage(): void {
    const targetId = this.streamingMessageId;
    if (!targetId) return;

    const message = this.messages.find(
      (m): m is Extract<Message, { type: "assistant" }> =>
        m.id === targetId && m.type === "assistant" && "isStreaming" in m,
    );
    if (message) {
      message.isStreaming = false;
    }
    this.streamingMessageId = null;
  }

  // Ensure a tool call block exists as soon as execution starts.
  // Correlates by toolCallId so we can handle out-of-order/dropped toolcall_end events.
  upsertToolCall(toolCall: {
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }): void {
    // Check if already present in any assistant message.
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (!message || message.type !== "assistant") continue;

      const existing = message.content.find(
        (b) => b.type === "toolCall" && b.id === toolCall.id,
      );
      if (existing && existing.type === "toolCall") {
        existing.name = toolCall.name;
        existing.arguments = toolCall.arguments;

        const pending = this.pendingToolResultsById.get(toolCall.id);
        if (pending) {
          existing.result = pending.result;
          existing.isError = pending.isError;
          this.pendingToolResultsById.delete(toolCall.id);
        }
        return;
      }
    }

    // Fallback: append to the most recent assistant message.
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (!message || message.type !== "assistant") continue;

      const nextBlock: Extract<ContentBlock, { type: "toolCall" }> = {
        type: "toolCall",
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      };

      const pending = this.pendingToolResultsById.get(toolCall.id);
      if (pending) {
        nextBlock.result = pending.result;
        nextBlock.isError = pending.isError;
        this.pendingToolResultsById.delete(toolCall.id);
      }

      (message as Extract<Message, { type: "assistant" }>).content.push(
        nextBlock,
      );
      return;
    }

    // Last resort: create a streaming assistant message and attach block.
    const id = this.createStreamingMessage();
    const message = this.messages.find(
      (m) => m.id === id && m.type === "assistant",
    );
    if (!message) return;

    const nextBlock: Extract<ContentBlock, { type: "toolCall" }> = {
      type: "toolCall",
      id: toolCall.id,
      name: toolCall.name,
      arguments: toolCall.arguments,
    };

    const pending = this.pendingToolResultsById.get(toolCall.id);
    if (pending) {
      nextBlock.result = pending.result;
      nextBlock.isError = pending.isError;
      this.pendingToolResultsById.delete(toolCall.id);
    }

    (message as Extract<Message, { type: "assistant" }>).content.push(
      nextBlock,
    );
  }

  // Update a tool call with its result.
  // We resolve by toolCallId (not by current streaming message) because tool_execution_end
  // is emitted after assistant message_end in pi-agent-core.
  // Performance: Direct property mutation instead of array recreation.
  updateToolCallResult(
    toolCallId: string,
    result: string,
    isError: boolean,
  ): void {
    // Prefer most recent assistant message first.
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i];
      if (!message || message.type !== "assistant") continue;

      // Find the tool call block and mutate directly
      const block = message.content.find(
        (b) => b.type === "toolCall" && b.id === toolCallId,
      );
      if (block && block.type === "toolCall") {
        block.result = result;
        block.isError = isError;
        return;
      }
    }

    this.pendingToolResultsById.set(toolCallId, { result, isError });
    console.warn("Tool result received for unknown toolCallId:", toolCallId);
  }

  // Add error message
  addErrorMessage(errorText: string): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: "assistant",
      content: [{ type: "text", text: `Error: ${errorText}` }],
      timestamp: new Date(),
    });
  }

  // Add system message
  addSystemMessage(text: string): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: "assistant",
      content: [{ type: "text", text }],
      timestamp: new Date(),
      isStreaming: false,
    });
  }

  private isSameUserContent(
    left: UserContentBlock[],
    right: UserContentBlock[],
  ): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      const leftBlock = left[index];
      const rightBlock = right[index];

      if (!leftBlock || !rightBlock || leftBlock.type !== rightBlock.type) {
        return false;
      }

      if (leftBlock.type === "text" && rightBlock.type === "text") {
        if (leftBlock.text !== rightBlock.text) {
          return false;
        }
        continue;
      }

      if (leftBlock.type === "image" && rightBlock.type === "image") {
        if (
          leftBlock.mimeType !== rightBlock.mimeType ||
          leftBlock.data !== rightBlock.data
        ) {
          return false;
        }
      }
    }

    return true;
  }

  static formatToolResultContent(content: unknown): string {
    if (content === null || content === undefined) {
      return "";
    }

    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      const textParts = content
        .map((block) => {
          if (typeof block === "string") return block;
          if (typeof block === "object" && block !== null && "type" in block) {
            const typed = block as { type?: string; text?: string };
            if (typed.type === "text" && typeof typed.text === "string") {
              return typed.text;
            }
          }
          return "";
        })
        .filter((part) => part.length > 0);

      if (textParts.length > 0) {
        return textParts.join("\n");
      }
    }

    try {
      return JSON.stringify(content, null, 2);
    } catch {
      return "[Unable to display result]";
    }
  }

  convertAssistantContent(content: unknown): ContentBlock[] {
    return MessagesStore.convertUnknownAssistantContent(content);
  }

  convertUserContent(content: unknown): UserContentBlock[] {
    return MessagesStore.convertUnknownUserContent(content);
  }

  static convertUnknownAssistantContent(content: unknown): ContentBlock[] {
    if (typeof content === "string") {
      return content.length > 0 ? [{ type: "text", text: content }] : [];
    }

    if (Array.isArray(content)) {
      return MessagesStore.convertContentBlocks(
        content.filter(
          (
            block,
          ): block is {
            type: string;
            text?: string;
            thinking?: string;
            id?: string;
            name?: string;
            arguments?: Record<string, unknown>;
          } =>
            typeof block === "object" &&
            block !== null &&
            "type" in block &&
            typeof (block as { type?: unknown }).type === "string",
        ),
      );
    }

    return [];
  }

  static convertUnknownUserContent(content: unknown): UserContentBlock[] {
    if (typeof content === "string") {
      if (content.length === 0) return [];
      return [{ type: "text", text: content }];
    }

    if (Array.isArray(content)) {
      const converted: UserContentBlock[] = [];

      for (const block of content) {
        if (typeof block === "string") {
          if (block.length > 0) {
            converted.push({ type: "text", text: block });
          }
          continue;
        }

        if (typeof block !== "object" || block === null || !("type" in block)) {
          continue;
        }

        const typed = block as {
          type?: unknown;
          text?: unknown;
          data?: unknown;
          mimeType?: unknown;
          source?: unknown;
        };

        if (typed.type === "text" && typeof typed.text === "string") {
          converted.push({ type: "text", text: typed.text });
          continue;
        }

        if (
          typed.type === "image" &&
          typeof typed.data === "string" &&
          typeof typed.mimeType === "string"
        ) {
          converted.push({
            type: "image",
            data: typed.data,
            mimeType: typed.mimeType,
          } satisfies PromptImageAttachment);
          continue;
        }

        // Compatibility fallback for providers that encode image source objects.
        const source = typed.source as
          | { type?: unknown; data?: unknown; mediaType?: unknown }
          | undefined;
        if (
          typed.type === "image" &&
          source &&
          typeof source === "object" &&
          source.type === "base64" &&
          typeof source.data === "string" &&
          typeof source.mediaType === "string"
        ) {
          converted.push({
            type: "image",
            data: source.data,
            mimeType: source.mediaType,
          } satisfies PromptImageAttachment);
        }
      }

      return converted;
    }

    if (content === undefined || content === null) {
      return [];
    }

    return [{ type: "text", text: JSON.stringify(content) }];
  }

  // Convert agent content blocks to our format
  static convertContentBlocks(
    agentContent: Array<{
      type: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }>,
  ): ContentBlock[] {
    const converted: ContentBlock[] = [];

    for (const block of agentContent) {
      if (block.type === "text") {
        converted.push({ type: "text", text: block.text ?? "" });
        continue;
      }
      if (block.type === "thinking") {
        converted.push({ type: "thinking", thinking: block.thinking ?? "" });
        continue;
      }
      if (block.type === "toolCall") {
        converted.push({
          type: "toolCall",
          id: block.id ?? "",
          name: block.name ?? "",
          arguments: block.arguments ?? {},
        });
      }
    }

    return converted;
  }
}

export function createMessagesStore(): MessagesStore {
  return new MessagesStore();
}
