import type { AgentEvent, ContentBlock } from '$lib/types/agent';
import { messagesStore } from '$lib/stores/messages.svelte';
import { agentStore } from '$lib/stores/agent.svelte';

function extractAssistantErrorMessage(message: { [key: string]: unknown }): string | null {
  if (typeof message.errorMessage === 'string' && message.errorMessage.trim().length > 0) {
    return message.errorMessage.trim();
  }

  if (message.stopReason === 'error') {
    return 'The model request failed. Check provider authentication and model settings.';
  }

  return null;
}

// Event handlers for agent events
export function handleAgentStart(): void {
  agentStore.setLoading(true);
}

export function handleAgentEnd(): void {
  agentStore.setLoading(false);
  messagesStore.finalizeStreamingMessage();
  agentStore.refreshState().catch((error) => {
    console.warn('Failed to refresh agent state:', error);
  });
}

export function handleMessageStart(event: Extract<AgentEvent, { type: 'message_start' }>): void {
  if (event.message.role === 'user') {
    messagesStore.addUserMessage(event.message);
  }
}

function upsertContentBlockAtIndex(
  content: ContentBlock[],
  index: number,
  block: ContentBlock,
): ContentBlock[] {
  const next = content.slice();

  // If we get an out-of-order index, keep array shape stable.
  while (next.length <= index) {
    next.push({ type: 'text', text: '' });
  }

  next[index] = block;
  return next;
}

function applyAssistantMessageDelta(
  current: ContentBlock[],
  assistantEvent: Extract<AgentEvent, { type: 'message_update' }>['assistantMessageEvent'],
): ContentBlock[] {
  const index = assistantEvent.contentIndex;
  if (typeof index !== 'number') {
    return current;
  }

  switch (assistantEvent.type) {
    case 'text_start':
      return upsertContentBlockAtIndex(current, index, { type: 'text', text: '' });

    case 'text_delta': {
      const existing = current[index];
      const existingText = existing?.type === 'text' ? existing.text : '';
      return upsertContentBlockAtIndex(current, index, {
        type: 'text',
        text: existingText + (assistantEvent.delta ?? ''),
      });
    }

    case 'text_end': {
      return upsertContentBlockAtIndex(current, index, {
        type: 'text',
        text: assistantEvent.content ?? '',
      });
    }

    case 'thinking_start':
      return upsertContentBlockAtIndex(current, index, { type: 'thinking', thinking: '' });

    case 'thinking_delta': {
      const existing = current[index];
      const existingThinking = existing?.type === 'thinking' ? existing.thinking : '';
      return upsertContentBlockAtIndex(current, index, {
        type: 'thinking',
        thinking: existingThinking + (assistantEvent.delta ?? ''),
      });
    }

    case 'thinking_end': {
      return upsertContentBlockAtIndex(current, index, {
        type: 'thinking',
        thinking: assistantEvent.content ?? assistantEvent.thinking ?? '',
      });
    }

    case 'toolcall_end': {
      if (!assistantEvent.toolCall) {
        return current;
      }

      return upsertContentBlockAtIndex(current, index, assistantEvent.toolCall);
    }

    // For toolcall_start/toolcall_delta we wait for toolcall_end (full object).
    default:
      return current;
  }
}

export function handleMessageUpdate(event: Extract<AgentEvent, { type: 'message_update' }>): void {
  if (event.message.role !== 'assistant') return;

  const streamingId = messagesStore.streamingMessageId;
  const hasStreamingMessage = !!streamingId && messagesStore.messages.some((m) => m.id === streamingId);

  const currentMessage = streamingId ? messagesStore.messages.find((m) => m.id === streamingId) : undefined;
  const currentContent = currentMessage?.type === 'assistant' ? currentMessage.content : [];

  const nextContent = applyAssistantMessageDelta(currentContent, event.assistantMessageEvent);

  // If the delta doesn't change visible content, don't create/update anything.
  if (!hasStreamingMessage && nextContent === currentContent) {
    return;
  }

  if (!hasStreamingMessage) {
    messagesStore.createStreamingMessage();
  }

  if (nextContent !== currentContent) {
    messagesStore.updateStreamingMessage(nextContent);
  }
}

export function handleMessageEnd(event: Extract<AgentEvent, { type: 'message_end' }>): void {
  if (event.message.role === 'assistant') {
    const content = messagesStore.convertAssistantContent(event.message.content);
    const errorMessage = extractAssistantErrorMessage(event.message);
    const resolvedContent = content.length > 0
      ? content
      : errorMessage
        ? [{ type: 'text' as const, text: `Error: ${errorMessage}` }]
        : [];

    const streamingId = messagesStore.streamingMessageId;
    const hasStreamingMessage = !!streamingId && messagesStore.messages.some(m => m.id === streamingId);

    if (hasStreamingMessage || resolvedContent.length > 0) {
      if (!hasStreamingMessage) {
        messagesStore.createStreamingMessage();
      }

      messagesStore.updateStreamingMessage(resolvedContent);
    }
  }

  messagesStore.finalizeStreamingMessage();
}

export function handleTurnEnd(): void {
  messagesStore.finalizeStreamingMessage();
}

// Main event router
export function handleAgentEvent(event: AgentEvent): void {
  switch (event.type) {
    case 'agent_start':
      handleAgentStart();
      break;

    case 'agent_end':
      handleAgentEnd();
      break;

    case 'turn_start':
      // Turn is starting - a new message will be created on first message_update
      break;

    case 'message_start':
      handleMessageStart(event);
      break;

    case 'message_update':
      handleMessageUpdate(event);
      break;

    case 'message_end':
      handleMessageEnd(event);
      break;

    case 'turn_end':
      handleTurnEnd();
      break;
  }
}
