import type { ContentBlock, Message } from "$lib/types/agent";

// Messages store manages message state and scroll behavior (session-scoped)
export class MessagesStore {
  messages = $state<Message[]>([]);
  streamingMessageId = $state<string | null>(null);

  // Scroll pinning state is intentionally non-reactive to avoid rerenders
  // during high-frequency scroll events.
  private isUserPinnedToBottom = true;
  private isProgrammaticScroll = false;
  private static readonly SCROLL_EPSILON_PX = 24;

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

  // Add user message from agent event
  addUserMessage(msg: { content?: unknown; timestamp?: number }): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: "user",
      content: this.convertUserContent(msg.content),
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
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

  convertUserContent(content: unknown): string {
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

  static convertUnknownUserContent(content: unknown): string {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === "string") return block;
          if (typeof block === "object" && block !== null && "type" in block) {
            const typed = block as { type: string; text?: string };
            if (typed.type === "text") {
              return typed.text ?? "";
            }
          }
          return "";
        })
        .join("");
    }

    if (content === undefined || content === null) {
      return "";
    }

    return JSON.stringify(content);
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
