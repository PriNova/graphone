/**
 * Slash command registry for Graphone.
 *
 * IMPORTANT: In RPC mode, pi-mono only handles:
 * - Extension commands (registered by extensions)
 * - Prompt templates (/template-name)
 * - Skills (/skill:name)
 *
 * Built-in commands like /settings, /model, /login are handled by the
 * interactive TUI mode and do NOT work in RPC mode. Sending them to the
 * sidecar will just treat them as regular text prompts to the LLM.
 */

export interface SlashCommand {
	name: string;
	description: string;
	/**
	 * How to handle this command:
	 * - 'local': Handle in Graphone UI (e.g., /clear)
	 * - 'rpc': Send to sidecar (works for extensions, templates, skills)
	 * - 'unimplemented': Known command that needs UI implementation
	 */
	handler: 'local' | 'rpc' | 'unimplemented';
}

/**
 * Commands that require interactive TUI and don't work in RPC mode.
 * These are handled in interactive-mode.ts, not agent-session.ts.
 */
export const UNIMPLEMENTED_COMMANDS: SlashCommand[] = [
	{ name: 'settings', description: 'Open settings menu', handler: 'unimplemented' },
	{ name: 'model', description: 'Select model (opens selector UI)', handler: 'unimplemented' },
	{ name: 'scoped-models', description: 'Enable/disable models for cycling', handler: 'unimplemented' },
	{ name: 'login', description: 'Login with OAuth provider', handler: 'unimplemented' },
	{ name: 'logout', description: 'Logout from OAuth provider', handler: 'unimplemented' },
	{ name: 'fork', description: 'Create a new fork from a previous message', handler: 'unimplemented' },
	{ name: 'tree', description: 'Navigate session tree', handler: 'unimplemented' },
	{ name: 'resume', description: 'Resume a different session', handler: 'unimplemented' },
	// These might work but need verification
	{ name: 'export', description: 'Export session to HTML file', handler: 'unimplemented' },
	{ name: 'share', description: 'Share session as a secret GitHub gist', handler: 'unimplemented' },
	{ name: 'copy', description: 'Copy last agent message to clipboard', handler: 'unimplemented' },
	{ name: 'name', description: 'Set session display name', handler: 'unimplemented' },
	{ name: 'session', description: 'Show session info and stats', handler: 'unimplemented' },
	{ name: 'changelog', description: 'Show changelog entries', handler: 'unimplemented' },
	{ name: 'hotkeys', description: 'Show all keyboard shortcuts', handler: 'unimplemented' },
	{ name: 'new', description: 'Start a new session', handler: 'unimplemented' },
	{ name: 'compact', description: 'Manually compact the session context', handler: 'unimplemented' },
	{ name: 'reload', description: 'Reload extensions, skills, prompts, and themes', handler: 'unimplemented' },
	{ name: 'quit', description: 'Quit pi', handler: 'unimplemented' },
];

/** Commands handled locally by Graphone UI */
export const LOCAL_COMMANDS: SlashCommand[] = [
	{ name: 'clear', description: 'Clear the conversation', handler: 'local' },
];

/**
 * Commands that work via RPC (extension commands, prompt templates, skills).
 * These are discovered dynamically from the sidecar via getCommands RPC call.
 */
export const RPC_COMMANDS: SlashCommand[] = [];

export const ALL_SLASH_COMMANDS: SlashCommand[] = [...UNIMPLEMENTED_COMMANDS, ...LOCAL_COMMANDS];

/**
 * Parse a message to check if it's a slash command.
 * Returns the command name and arguments if it starts with /
 */
export function parseSlashCommand(message: string): { command: string; args: string } | null {
	const trimmed = message.trim();
	if (!trimmed.startsWith('/')) return null;

	const withoutSlash = trimmed.slice(1);
	const spaceIndex = withoutSlash.indexOf(' ');

	if (spaceIndex === -1) {
		return { command: withoutSlash, args: '' };
	}

	return {
		command: withoutSlash.slice(0, spaceIndex),
		args: withoutSlash.slice(spaceIndex + 1).trim(),
	};
}

/**
 * Check if a command name is a known slash command.
 */
export function isKnownSlashCommand(commandName: string): boolean {
	return ALL_SLASH_COMMANDS.some((cmd) => cmd.name === commandName);
}

/**
 * Get command handler type.
 */
export function getCommandHandler(commandName: string): 'local' | 'rpc' | 'unimplemented' | null {
	const cmd = ALL_SLASH_COMMANDS.find((c) => c.name === commandName);
	return cmd?.handler ?? null;
}

/**
 * Check if a command requires UI implementation.
 */
export function isUnimplementedCommand(commandName: string): boolean {
	return UNIMPLEMENTED_COMMANDS.some((c) => c.name === commandName);
}
