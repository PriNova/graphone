import type { Message, ContentBlock, AgentEvent } from '$lib/types/agent';

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
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
          timestamp
        });
      } else if (msg.role === 'assistant') {
        loadedMessages.push({
          id: crypto.randomUUID(),
          type: 'assistant',
          content: [],
          timestamp,
          isStreaming: false
        });
      }
    }

    this.messages = loadedMessages;
  }

  // Add user message from agent event
  addUserMessage(msg: { content?: unknown; timestamp?: number }): void {
    const content = typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((c: unknown) => {
            if (typeof c === 'object' && c !== null && 'type' in c) {
              const block = c as { type: string; text?: string };
              if (block.type === 'text') return block.text || '';
            }
            return '';
          }).join('')
        : msg.content !== undefined ? JSON.stringify(msg.content) : '';

    this.addMessage({
      id: crypto.randomUUID(),
      type: 'user',
      content,
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

  // Convert agent content blocks to our format
  static convertContentBlocks(agentContent: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: Record<string, unknown> }>): ContentBlock[] {
    return agentContent.map(block => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text ?? '' };
      }
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking ?? '' };
      }
      if (block.type === 'toolCall') {
        return {
          type: 'toolCall',
          id: block.id ?? '',
          name: block.name ?? '',
          arguments: block.arguments ?? {}
        };
      }
      return { type: 'text', text: '' };
    });
  }
}

export const messagesStore = new MessagesStore();
