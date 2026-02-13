import { getCommandHandler } from '$lib/slash-commands';
import { agentStore } from '$lib/stores/agent.svelte';
import { messagesStore } from '$lib/stores/messages.svelte';

// Result types for command handling
export type CommandResult = 
  | { type: 'handled' }
  | { type: 'submit'; text: string }
  | { type: 'error'; message: string };

// Handle slash commands
export async function handleSlashCommand(command: string, args: string, fullText: string): Promise<CommandResult> {
  if (!agentStore.sessionStarted) {
    return { 
      type: 'error', 
      message: 'Agent session not started. Please wait for initialization.' 
    };
  }

  const handler = getCommandHandler(command);

  if (handler === 'local') {
    if (command === 'model') {
      messagesStore.addSystemMessage('Use the model dropdown next to the prompt input to switch models.');
      return { type: 'handled' };
    }

    return { type: 'handled' };
  }

  if (handler === 'unimplemented') {
    messagesStore.addSystemMessage(
      `Command "/${command}" requires a UI that hasn't been implemented yet in Graphone.\n\nThis command works in the terminal UI (TUI) mode.`
    );
    return { type: 'handled' };
  }

  if (handler === 'rpc') {
    // Handle specific RPC commands
    if (command === 'new') {
      const created = await agentStore.newSession();
      if (created) {
        messagesStore.clearMessages();
      }
      return { type: 'handled' };
    }

    // Extension commands, prompt templates, and skills work via RPC
    return { type: 'submit', text: fullText };
  }

  // Unknown command - treat as regular message
  return { type: 'submit', text: fullText };
}

// Handle regular prompt submission
export async function handlePromptSubmit(prompt: string): Promise<void> {
  if (!agentStore.sessionStarted) {
    messagesStore.addErrorMessage('Agent session not started. Please wait for initialization.');
    return;
  }

  try {
    await agentStore.sendPrompt(prompt);
  } catch (error) {
    console.error('Error sending prompt:', error);
    messagesStore.addErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
