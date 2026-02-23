import { invoke } from "@tauri-apps/api/core";
import { getCommandHandler } from "$lib/slash-commands";
import type {
  AgentStore,
  OAuthLoginStatus,
  OAuthLoginUpdate,
  OAuthProviderStatus,
} from "$lib/stores/agent.svelte";
import type { MessagesStore } from "$lib/stores/messages.svelte";
import type { PromptImageAttachment } from "$lib/types/agent";

const OAUTH_POLL_INTERVAL_MS = 240;
const OAUTH_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const OAUTH_AUTO_OPEN_TIMEOUT_MS = 1500;
const OAUTH_PROMPT_NOTICE_DELAY_MS = 8000;

const ANSI_ESCAPE_PATTERN =
  /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g;
const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000b-\u001a\u001c-\u001f\u007f]/g;

interface OAuthMonitorState {
  providerId: string;
  providerName: string;
  startedAt: number;
  lastAuthUrl?: string;
  lastPromptMessage?: string;
  promptNoticeTimer: ReturnType<typeof setTimeout> | null;
}

const oauthMonitorBySession = new Map<string, OAuthMonitorState>();

export interface SessionRuntimeForCommands {
  agent: AgentStore;
  messages: MessagesStore;
}

// Result types for command handling
export type CommandResult =
  | { type: "handled" }
  | { type: "submit"; text: string }
  | { type: "error"; message: string };

function sanitizeDisplayText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "")
    .trim();
}

function sanitizeUrl(url: string): string {
  const cleaned = sanitizeDisplayText(url);
  const [first] = cleaned.split(/\s+/);
  return first ?? "";
}

function parseProviderAndOptionalInput(args: string): {
  providerId: string | null;
  manualInput: string | null;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { providerId: null, manualInput: null };
  }

  const firstSpaceIndex = trimmed.indexOf(" ");
  if (firstSpaceIndex === -1) {
    return { providerId: trimmed, manualInput: null };
  }

  const providerId = trimmed.slice(0, firstSpaceIndex).trim();
  const manualInput = trimmed.slice(firstSpaceIndex + 1).trim();

  return {
    providerId: providerId.length > 0 ? providerId : null,
    manualInput: manualInput.length > 0 ? manualInput : null,
  };
}

function formatProviderLine(provider: OAuthProviderStatus): string {
  return `- ${provider.id} — ${provider.name}${provider.loggedIn ? " (logged in)" : ""}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAuthDependentState(agent: AgentStore): Promise<void> {
  await Promise.allSettled([agent.refreshState(), agent.loadAvailableModels()]);
}

function isOAuthTerminalStatus(status: OAuthLoginStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

function clearPromptNoticeTimer(state: OAuthMonitorState): void {
  if (state.promptNoticeTimer !== null) {
    clearTimeout(state.promptNoticeTimer);
    state.promptNoticeTimer = null;
  }
}

function tryWindowOpen(url: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    return opened !== null;
  } catch {
    return false;
  }
}

async function openAuthUrl(url: string): Promise<{
  opened: boolean;
  timedOut: boolean;
  error?: string;
}> {
  const cleanUrl = sanitizeUrl(url);
  if (!cleanUrl) {
    return { opened: false, timedOut: false, error: "Invalid OAuth URL" };
  }

  const openerOutcome = await Promise.race([
    invoke("open_external_url", { url: cleanUrl })
      .then(() => ({ type: "opened" as const }))
      .catch((error: unknown) => ({
        type: "error" as const,
        message: error instanceof Error ? error.message : String(error),
      })),
    sleep(OAUTH_AUTO_OPEN_TIMEOUT_MS).then(() => ({
      type: "timeout" as const,
    })),
  ]);

  if (openerOutcome.type === "opened") {
    return { opened: true, timedOut: false };
  }

  const openedByWindow = tryWindowOpen(cleanUrl);
  if (openedByWindow) {
    return {
      opened: true,
      timedOut: openerOutcome.type === "timeout",
      error:
        openerOutcome.type === "error"
          ? sanitizeDisplayText(openerOutcome.message)
          : undefined,
    };
  }

  return {
    opened: false,
    timedOut: openerOutcome.type === "timeout",
    error:
      openerOutcome.type === "error"
        ? sanitizeDisplayText(openerOutcome.message)
        : undefined,
  };
}

function startOAuthMonitor(
  runtime: SessionRuntimeForCommands,
  provider: OAuthProviderStatus,
): void {
  const sessionId = runtime.agent.sessionId;
  if (oauthMonitorBySession.has(sessionId)) {
    return;
  }

  const state: OAuthMonitorState = {
    providerId: provider.id,
    providerName: provider.name,
    startedAt: Date.now(),
    promptNoticeTimer: null,
  };

  oauthMonitorBySession.set(sessionId, state);

  void (async () => {
    try {
      while (true) {
        if (Date.now() - state.startedAt > OAUTH_POLL_TIMEOUT_MS) {
          await runtime.agent.cancelOAuthLogin().catch(() => undefined);
          runtime.messages.addErrorMessage(
            `OAuth login for ${state.providerName} timed out.`,
          );
          break;
        }

        const poll = await runtime.agent.pollOAuthLogin();

        for (const update of poll.updates) {
          if (update.type === "auth") {
            const cleanInstructions = update.instructions
              ? sanitizeDisplayText(update.instructions)
              : "";
            const cleanUrl = sanitizeUrl(update.url);

            if (cleanUrl && cleanUrl !== state.lastAuthUrl) {
              state.lastAuthUrl = cleanUrl;

              const details = cleanInstructions
                ? `${cleanInstructions}\n\n${cleanUrl}`
                : cleanUrl;

              runtime.messages.addSystemMessage(
                `Authorize ${state.providerName} in your browser:\n${details}`,
              );

              const openResult = await openAuthUrl(cleanUrl);
              if (!openResult.opened) {
                const reason = openResult.error
                  ? ` (${openResult.error})`
                  : openResult.timedOut
                    ? " (timed out)"
                    : "";

                runtime.messages.addSystemMessage(
                  `Could not auto-open browser${reason}. Open this URL manually:\n${cleanUrl}`,
                );
              }
            }
            continue;
          }

          if (update.type === "progress") {
            runtime.messages.addSystemMessage(
              `[${state.providerName}] ${sanitizeDisplayText(update.message)}`,
            );
            continue;
          }

          if (update.type === "prompt") {
            const cleanPrompt = sanitizeDisplayText(update.message);
            if (
              cleanPrompt.length > 0 &&
              cleanPrompt !== state.lastPromptMessage
            ) {
              state.lastPromptMessage = cleanPrompt;
              clearPromptNoticeTimer(state);

              state.promptNoticeTimer = setTimeout(() => {
                const active = oauthMonitorBySession.get(sessionId);
                if (active !== state) {
                  return;
                }

                runtime.messages.addSystemMessage(
                  `${state.providerName} requires additional input:\n${cleanPrompt}\n\nSubmit it with:\n/login ${state.providerId} [redirect-url-or-code]`,
                );
                state.promptNoticeTimer = null;
              }, OAUTH_PROMPT_NOTICE_DELAY_MS);
            }
            continue;
          }

          if (update.type === "complete") {
            clearPromptNoticeTimer(state);

            if (update.success) {
              runtime.messages.addSystemMessage(
                `Logged in to ${state.providerName}.`,
              );
              await refreshAuthDependentState(runtime.agent);
            } else {
              runtime.messages.addErrorMessage(
                update.error
                  ? `Failed to login to ${state.providerName}: ${sanitizeDisplayText(update.error)}`
                  : `Failed to login to ${state.providerName}.`,
              );
            }
            return;
          }
        }

        if (isOAuthTerminalStatus(poll.status)) {
          clearPromptNoticeTimer(state);

          if (poll.status === "completed") {
            runtime.messages.addSystemMessage(
              `Logged in to ${state.providerName}.`,
            );
            await refreshAuthDependentState(runtime.agent);
          } else if (poll.status === "cancelled") {
            runtime.messages.addSystemMessage("OAuth login cancelled.");
          } else if (poll.status === "failed") {
            runtime.messages.addErrorMessage(
              `Failed to login to ${state.providerName}. Please retry.`,
            );
          }
          break;
        }

        await sleep(OAUTH_POLL_INTERVAL_MS);
      }
    } catch (error) {
      runtime.messages.addErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearPromptNoticeTimer(state);

      const current = oauthMonitorBySession.get(sessionId);
      if (current === state) {
        oauthMonitorBySession.delete(sessionId);
      }
    }
  })();
}

async function handleLoginCommand(
  runtime: SessionRuntimeForCommands,
  args: string,
): Promise<void> {
  const providers = await runtime.agent.getOAuthProviders();
  if (providers.length === 0) {
    runtime.messages.addSystemMessage(
      "No OAuth providers are currently available.",
    );
    return;
  }

  const parsedArgs = parseProviderAndOptionalInput(args);
  if (!parsedArgs.providerId) {
    runtime.messages.addSystemMessage(
      `Available OAuth providers:\n${providers.map(formatProviderLine).join("\n")}\n\nUse /login <provider-id> to authenticate.`,
    );
    return;
  }

  const provider = providers.find((item) => item.id === parsedArgs.providerId);
  if (!provider) {
    runtime.messages.addSystemMessage(
      `Unknown OAuth provider "${parsedArgs.providerId}".\n\nAvailable providers:\n${providers.map(formatProviderLine).join("\n")}`,
    );
    return;
  }

  const activeFlow = await runtime.agent.pollOAuthLogin();
  const activeFlowRunning =
    activeFlow.status === "running" || activeFlow.status === "awaiting_input";

  if (activeFlowRunning) {
    const activeProvider = activeFlow.provider;
    const matchesProvider = !activeProvider || activeProvider === provider.id;

    if (!matchesProvider) {
      throw new Error(
        `Another OAuth login flow is already active (${activeProvider ?? "unknown provider"}). Complete or cancel it first.`,
      );
    }

    if (parsedArgs.manualInput) {
      await runtime.agent.submitOAuthLoginInput(parsedArgs.manualInput);
      runtime.messages.addSystemMessage(
        `Submitted OAuth login input for ${provider.name}.`,
      );
    } else {
      runtime.messages.addSystemMessage(
        `OAuth login for ${provider.name} is already in progress.`,
      );
    }

    startOAuthMonitor(runtime, provider);
    return;
  }

  runtime.messages.addSystemMessage(
    `Starting OAuth login for ${provider.name}...`,
  );
  await runtime.agent.startOAuthLogin(provider.id);

  if (parsedArgs.manualInput) {
    await runtime.agent
      .submitOAuthLoginInput(parsedArgs.manualInput)
      .catch(() => undefined);
  }

  startOAuthMonitor(runtime, provider);
}

async function handleLogoutCommand(
  runtime: SessionRuntimeForCommands,
  args: string,
): Promise<void> {
  const providers = await runtime.agent.getOAuthProviders();
  if (providers.length === 0) {
    runtime.messages.addSystemMessage(
      "No OAuth providers are currently available.",
    );
    return;
  }

  const parsedArgs = parseProviderAndOptionalInput(args);
  if (!parsedArgs.providerId) {
    const loggedIn = providers.filter((provider) => provider.loggedIn);
    if (loggedIn.length === 0) {
      runtime.messages.addSystemMessage(
        "No OAuth providers are currently logged in.",
      );
      return;
    }

    runtime.messages.addSystemMessage(
      `Logged in providers:\n${loggedIn.map(formatProviderLine).join("\n")}\n\nUse /logout <provider-id> to logout.`,
    );
    return;
  }

  const provider = providers.find((item) => item.id === parsedArgs.providerId);
  if (!provider) {
    runtime.messages.addSystemMessage(
      `Unknown OAuth provider "${parsedArgs.providerId}".\n\nAvailable providers:\n${providers.map(formatProviderLine).join("\n")}`,
    );
    return;
  }

  const loggedOut = await runtime.agent.logoutOAuthProvider(provider.id);
  await refreshAuthDependentState(runtime.agent);

  runtime.messages.addSystemMessage(
    loggedOut
      ? `Logged out of ${provider.name}.`
      : `${provider.name} is not logged in.`,
  );
}

// Handle slash commands
export async function handleSlashCommand(
  runtime: SessionRuntimeForCommands,
  command: string,
  args: string,
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

    if (command === "login") {
      try {
        await handleLoginCommand(runtime, args);
      } catch (error) {
        return {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
      return { type: "handled" };
    }

    if (command === "logout") {
      try {
        await handleLogoutCommand(runtime, args);
      } catch (error) {
        return {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        };
      }
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
  images?: PromptImageAttachment[],
): Promise<void> {
  if (!runtime.agent.sessionStarted) {
    runtime.messages.addErrorMessage(
      "Agent session not started. Please wait for initialization.",
    );
    return;
  }

  const optimisticContent = [
    ...(prompt.length > 0 ? [{ type: "text" as const, text: prompt }] : []),
    ...(images ?? []),
  ];

  runtime.messages.addOptimisticUserMessage(optimisticContent);

  try {
    await runtime.agent.sendPrompt(prompt, images);
  } catch (error) {
    console.error("Error sending prompt:", error);
    runtime.messages.addErrorMessage(
      error instanceof Error ? error.message : String(error),
    );
  }
}
