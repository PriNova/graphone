import type { AvailableSlashCommand } from "$lib/stores/agent.svelte";

/**
 * Slash command registry for Graphone.
 *
 * IMPORTANT: In RPC mode, pi-mono only handles:
 * - Extension commands (registered by extensions)
 * - Prompt templates (/template-name)
 * - Skills (/skill:name)
 *
 * Built-in commands like /settings are handled by the interactive TUI mode
 * and do NOT work in plain RPC mode. Sending them to the sidecar will just
 * treat them as regular text prompts to the LLM.
 *
 * Note: Graphone handles /model, /login, and /logout locally.
 */

export interface SlashCommand {
  name: string;
  description: string;
  /**
   * How to handle this command:
   * - 'local': Handle in Graphone UI (e.g., /clear)
   * - 'rpc': Handle via the pi runtime/sidecar
   * - 'unimplemented': Known command that needs UI implementation
   */
  handler: "local" | "rpc" | "unimplemented";
}

/** Commands that require interactive TUI and don't work in RPC mode. */
export const UNIMPLEMENTED_COMMANDS: SlashCommand[] = [
  {
    name: "settings",
    description: "Open settings menu",
    handler: "unimplemented",
  },
  {
    name: "scoped-models",
    description: "Enable/disable models for cycling",
    handler: "unimplemented",
  },
  {
    name: "fork",
    description: "Create a new fork from a previous message",
    handler: "unimplemented",
  },
  {
    name: "tree",
    description: "Open the session tree transcript view",
    handler: "local",
  },
  {
    name: "resume",
    description: "Resume a different session",
    handler: "unimplemented",
  },
  {
    name: "export",
    description: "Export session to HTML file",
    handler: "unimplemented",
  },
  {
    name: "share",
    description: "Share session as a secret GitHub gist",
    handler: "unimplemented",
  },
  {
    name: "copy",
    description: "Copy last agent message to clipboard",
    handler: "unimplemented",
  },
  {
    name: "name",
    description: "Set session display name",
    handler: "unimplemented",
  },
  {
    name: "session",
    description: "Show session info and stats",
    handler: "unimplemented",
  },
  {
    name: "changelog",
    description: "Show changelog entries",
    handler: "unimplemented",
  },
  {
    name: "hotkeys",
    description: "Show all keyboard shortcuts",
    handler: "unimplemented",
  },
  {
    name: "compact",
    description: "Manually compact the session context",
    handler: "unimplemented",
  },
  {
    name: "reload",
    description: "Reload extensions, skills, prompts, and themes",
    handler: "unimplemented",
  },
  { name: "quit", description: "Quit pi", handler: "unimplemented" },
];

/** Commands handled locally by Graphone UI */
export const LOCAL_COMMANDS: SlashCommand[] = [
  {
    name: "model",
    description: "Select model using the dropdown",
    handler: "local",
  },
  {
    name: "login",
    description: "Login with OAuth provider (/login <provider>)",
    handler: "local",
  },
  {
    name: "logout",
    description: "Logout from OAuth provider (/logout <provider>)",
    handler: "local",
  },
];

/** Static RPC commands exposed directly by Graphone. */
export const RPC_COMMANDS: SlashCommand[] = [
  { name: "new", description: "Start a new session", handler: "rpc" },
];

export const ALL_SLASH_COMMANDS: SlashCommand[] = [
  ...UNIMPLEMENTED_COMMANDS,
  ...LOCAL_COMMANDS,
  ...RPC_COMMANDS,
];

function toRuntimeSlashCommand(command: AvailableSlashCommand): SlashCommand {
  return {
    name: command.name,
    description: command.description,
    handler: "rpc",
  };
}

export function getAvailableSlashCommands(
  runtimeCommands: AvailableSlashCommand[] = [],
): SlashCommand[] {
  const merged = new Map<string, SlashCommand>();

  for (const command of ALL_SLASH_COMMANDS) {
    merged.set(command.name, command);
  }

  for (const command of runtimeCommands) {
    if (merged.has(command.name)) {
      continue;
    }

    merged.set(command.name, toRuntimeSlashCommand(command));
  }

  return Array.from(merged.values());
}

/**
 * Parse a message to check if it's a slash command.
 * Returns the command name and arguments if it starts with /
 */
export function parseSlashCommand(
  message: string,
): { command: string; args: string } | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith("/")) return null;

  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.indexOf(" ");

  if (spaceIndex === -1) {
    return { command: withoutSlash, args: "" };
  }

  return {
    command: withoutSlash.slice(0, spaceIndex),
    args: withoutSlash.slice(spaceIndex + 1).trim(),
  };
}

/** Check if a command name is a known slash command. */
export function isKnownSlashCommand(
  commandName: string,
  runtimeCommands: AvailableSlashCommand[] = [],
): boolean {
  return getAvailableSlashCommands(runtimeCommands).some(
    (cmd) => cmd.name === commandName,
  );
}

/** Get command handler type. */
export function getCommandHandler(
  commandName: string,
  runtimeCommands: AvailableSlashCommand[] = [],
): "local" | "rpc" | "unimplemented" | null {
  const cmd = getAvailableSlashCommands(runtimeCommands).find(
    (candidate) => candidate.name === commandName,
  );
  return cmd?.handler ?? null;
}

/** Check if a command requires UI implementation. */
export function isUnimplementedCommand(commandName: string): boolean {
  return UNIMPLEMENTED_COMMANDS.some((c) => c.name === commandName);
}
