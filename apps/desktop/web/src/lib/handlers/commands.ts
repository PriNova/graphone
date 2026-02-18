import { getCommandHandler } from "$lib/slash-commands";
import type { AgentStore } from "$lib/stores/agent.svelte";
import type { MessagesStore } from "$lib/stores/messages.svelte";

export interface SessionRuntimeForCommands {
  agent: AgentStore;
  messages: MessagesStore;
}

// Result types for command handling
export type CommandResult =
  | { type: "handled" }
  | { type: "submit"; text: string }
  | { type: "error"; message: string };

// Handle slash commands
export async function handleSlashCommand(
  runtime: SessionRuntimeForCommands,
  command: string,
  _args: string,
  fullText: string,
): Promise<CommandResult> {
  if (!runtime.agent.sessionStarted) {
    return {
      type: "error",
      message: "Agent session not started. Please wait for initialization.",
    };
  }

  const handler = getCommandHandler(command);

  if (handler === "local") {
    if (command === "model") {
      runtime.messages.addSystemMessage(
        "Use the model dropdown next to the prompt input to switch models.",
      );
      return { type: "handled" };
    }

    return { type: "handled" };
  }

  if (handler === "unimplemented") {
    runtime.messages.addSystemMessage(
      `Command "/${command}" requires a UI that hasn't been implemented yet in Graphone.\n\nThis command works in the terminal UI (TUI) mode.`,
    );
    return { type: "handled" };
  }

  if (handler === "rpc") {
    // Handle specific RPC commands
    if (command === "new") {
      const created = await runtime.agent.newSession();
      if (created) {
        runtime.messages.clearMessages();
      }
      return { type: "handled" };
    }

    // Extension commands, prompt templates, and skills work via prompt routing
    return { type: "submit", text: fullText };
  }

  // Unknown command - treat as regular message
  return { type: "submit", text: fullText };
}

// Handle regular prompt submission
export async function handlePromptSubmit(
  runtime: SessionRuntimeForCommands,
  prompt: string,
): Promise<void> {
  if (!runtime.agent.sessionStarted) {
    runtime.messages.addErrorMessage(
      "Agent session not started. Please wait for initialization.",
    );
    return;
  }

  try {
    await runtime.agent.sendPrompt(prompt);
  } catch (error) {
    console.error("Error sending prompt:", error);
    runtime.messages.addErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
  }
}
