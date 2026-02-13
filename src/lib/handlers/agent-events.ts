import type { AgentEvent } from '$lib/types/agent';
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

export function handleMessageUpdate(event: Extract<AgentEvent, { type: 'message_update' }>): void {
  const agentMessage = event.message;
  if (agentMessage.role !== 'assistant') return;

  const content = messagesStore.convertAssistantContent(agentMessage.content);

  // Avoid creating empty assistant placeholders
  const streamingId = messagesStore.streamingMessageId;
  const hasStreamingMessage = !!streamingId && messagesStore.messages.some(m => m.id === streamingId);
  if (!hasStreamingMessage && content.length === 0) {
    return;
  }

  if (!hasStreamingMessage) {
    messagesStore.createStreamingMessage();
  }

  if (content.length > 0) {
    messagesStore.updateStreamingMessage(content);
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
