import type { Message, ContentBlock } from '$lib/types/agent';

// Messages store manages message state and scroll behavior
class MessagesStore {
  messages = $state<Message[]>([]);
  isUserNearBottom = $state(true);
  streamingMessageId = $state<string | null>(null);

  // Scroll tracking
  updateScrollPosition(container: HTMLDivElement): void {
    const { scrollTop, scrollHeight, clientHeight } = container;
    this.isUserNearBottom = scrollHeight - scrollTop - clientHeight < 100;
  }

  scrollToBottom(container: HTMLDivElement | null, smooth = true): void {
    if (container && this.isUserNearBottom) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
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

  // Convert agent messages from backend to our Message format
  loadFromAgentMessages(agentMessages: Array<{ role: string; content: unknown; timestamp?: number }>): void {
    const loadedMessages: Message[] = [];

    for (const msg of agentMessages) {
      const timestamp = msg.timestamp ? new Date(msg.timestamp) : new Date();

      if (msg.role === 'user') {
        loadedMessages.push({
          id: crypto.randomUUID(),
          type: 'user',
          content: this.convertUserContent(msg.content),
          timestamp
        });
      } else if (msg.role === 'assistant') {
        loadedMessages.push({
          id: crypto.randomUUID(),
          type: 'assistant',
          content: this.convertAssistantContent(msg.content),
          timestamp,
          isStreaming: false
        });
      }
    }

    this.messages = loadedMessages;
  }

  // Add user message from agent event
  addUserMessage(msg: { content?: unknown; timestamp?: number }): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: 'user',
      content: this.convertUserContent(msg.content),
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date()
    });
  }

  // Create new streaming assistant message
  createStreamingMessage(): string {
    const id = crypto.randomUUID();
    this.streamingMessageId = id;
    this.addMessage({
      id,
      type: 'assistant',
      content: [],
      timestamp: new Date(),
      isStreaming: true
    });
    return id;
  }

  // Update streaming message content
  updateStreamingMessage(content: ContentBlock[]): void {
    const targetId = this.streamingMessageId;
    if (!targetId) return;

    this.messages = this.messages.map(m =>
      m.id === targetId && m.type === 'assistant'
        ? { ...m, content }
        : m
    );
  }

  // Finalize streaming message
  finalizeStreamingMessage(): void {
    const targetId = this.streamingMessageId;
    if (!targetId) return;

    this.messages = this.messages.map(m =>
      m.id === targetId && m.type === 'assistant' && m.isStreaming
        ? { ...m, isStreaming: false }
        : m
    );
    this.streamingMessageId = null;
  }

  // Add error message
  addErrorMessage(errorText: string): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: 'assistant',
      content: [{ type: 'text', text: `Error: ${errorText}` }],
      timestamp: new Date()
    });
  }

  // Add system message
  addSystemMessage(text: string): void {
    this.addMessage({
      id: crypto.randomUUID(),
      type: 'assistant',
      content: [{ type: 'text', text }],
      timestamp: new Date(),
      isStreaming: false
    });
  }

  convertAssistantContent(content: unknown): ContentBlock[] {
    return MessagesStore.convertUnknownAssistantContent(content);
  }

  convertUserContent(content: unknown): string {
    return MessagesStore.convertUnknownUserContent(content);
  }

  static convertUnknownAssistantContent(content: unknown): ContentBlock[] {
    if (typeof content === 'string') {
      return content.length > 0 ? [{ type: 'text', text: content }] : [];
    }

    if (Array.isArray(content)) {
      return MessagesStore.convertContentBlocks(
        content.filter((block): block is { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown> } =>
          typeof block === 'object' && block !== null && 'type' in block && typeof (block as { type?: unknown }).type === 'string'
        )
      );
    }

    return [];
  }

  static convertUnknownUserContent(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      return content
        .map((block) => {
          if (typeof block === 'string') return block;
          if (typeof block === 'object' && block !== null && 'type' in block) {
            const typed = block as { type: string; text?: string };
            if (typed.type === 'text') {
              return typed.text ?? '';
            }
          }
          return '';
        })
        .join('');
    }

    if (content === undefined || content === null) {
      return '';
    }

    return JSON.stringify(content);
  }

  // Convert agent content blocks to our format
  static convertContentBlocks(agentContent: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>): ContentBlock[] {
    const converted: ContentBlock[] = [];

    for (const block of agentContent) {
      if (block.type === 'text') {
        converted.push({ type: 'text', text: block.text ?? '' });
        continue;
      }
      if (block.type === 'thinking') {
        converted.push({ type: 'thinking', thinking: block.thinking ?? '' });
        continue;
      }
      if (block.type === 'toolCall') {
        converted.push({
          type: 'toolCall',
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: block.arguments ?? {}
        });
      }
    }

    return converted;
  }
}

export const messagesStore = new MessagesStore();
