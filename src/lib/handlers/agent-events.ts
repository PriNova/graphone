import type { AgentEvent } from '$lib/types/agent';
import { messagesStore } from '$lib/stores/messages.svelte';
import { agentStore } from '$lib/stores/agent.svelte';

// Event handlers for agent events
export function handleAgentStart(): void {
  agentStore.setLoading(true);
}

export function handleAgentEnd(): void {
  agentStore.setLoading(false);
  messagesStore.finalizeStreamingMessage();
}

export function handleMessageStart(event: Extract<AgentEvent, { type: 'message_start' }>): void {
  if (event.message.role === 'user') {
    messagesStore.addUserMessage(event.message);
  }
}

export function handleMessageUpdate(event: Extract<AgentEvent, { type: 'message_update' }>): void {
  const agentMessage = event.message;
  if (agentMessage.role !== 'assistant') return;

  // Ensure we have a streaming message
  let targetId = messagesStore.streamingMessageId;
  if (!targetId || !messagesStore.messages.find(m => m.id === targetId)) {
    targetId = messagesStore.createStreamingMessage();
  }

  // Convert and update content
  const content = messagesStore.constructor.prototype.constructor.convertContentBlocks(agentMessage.content);
  messagesStore.updateStreamingMessage(content);
}

export function handleMessageEnd(): void {
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
      handleMessageEnd();
      break;

    case 'turn_end':
      handleTurnEnd();
      break;
  }
}
