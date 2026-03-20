import type { PromptImageAttachment } from "$lib/types/agent";
import { invokeAgentCommand, invokeAgentRpc } from "$lib/stores/agent/api";
import {
  parseAvailableModels,
  parseAvailableSlashCommands,
  parseAvailableThinkingLevels,
  parseExtensionStatuses,
  parseModelSupportsImageInput,
  parseNavigateSessionTreeResult,
  parseOAuthLoginStatus,
  parseOAuthLoginUpdates,
  parseOAuthProviders,
  parseRegisteredExtensions,
  parseSessionTreeSnapshot,
  parseThinkingLevel,
  parseUsageIndicator,
  sortAvailableModels,
} from "$lib/stores/agent/parsers";
import type {
  AvailableModel,
  AvailableSlashCommand,
  ExtensionStatusEntry,
  NavigateSessionTreeResult,
  OAuthLoginPollResult,
  OAuthProviderStatus,
  RegisteredExtensionSummary,
  SessionTreeSnapshot,
  ThinkingLevel,
  UsageIndicatorSnapshot,
} from "$lib/stores/agent/types";

export type {
  AvailableModel,
  AvailableSlashCommand,
  ExtensionStatusEntry,
  NavigateSessionTreeResult,
  OAuthLoginPollResult,
  OAuthLoginStatus,
  OAuthLoginUpdate,
  OAuthProviderStatus,
  RegisteredExtensionScope,
  RegisteredExtensionSummary,
  RegisteredExtensionsSnapshot,
  SessionTreeEntryType,
  SessionTreeNodeRole,
  SessionTreeNodeSnapshot,
  SessionTreeSnapshot,
  ThinkingLevel,
  UsageContextSeverity,
  UsageIndicatorSnapshot,
} from "$lib/stores/agent/types";

interface AgentStateResponseData {
  model?: { id?: unknown; provider?: unknown; input?: unknown };
  thinkingLevel?: unknown;
  supportsThinking?: unknown;
  availableThinkingLevels?: unknown;
  usageIndicator?: unknown;
  extensionUi?: { statuses?: unknown };
  sessionId?: unknown;
}

interface AvailableModelsResponseData {
  models?: unknown;
}

interface OAuthProvidersResponseData {
  providers?: unknown;
}

interface OAuthLoginPollResponseData {
  status?: unknown;
  provider?: unknown;
  updates?: unknown;
}

interface LogoutOAuthProviderResponseData {
  loggedOut?: unknown;
}

interface BashCommandResponseData {
  output?: unknown;
  exitCode?: unknown;
  cancelled?: unknown;
  truncated?: unknown;
  fullOutputPath?: unknown;
}

interface RegisteredExtensionsResponseData {
  global?: unknown;
  local?: unknown;
  errors?: unknown;
}

interface AvailableSlashCommandsResponseData {
  commands?: unknown;
}

interface SessionTreeResponseData {
  currentLeafId?: unknown;
  entries?: unknown;
}

interface NavigateSessionTreeResponseData {
  editorText?: unknown;
  cancelled?: unknown;
  aborted?: unknown;
  summaryCreated?: unknown;
}

// Agent session state (session-scoped)
export class AgentStore {
  readonly sessionId: string;

  sessionStarted = $state(false);
  isLoading = $state(false);
  isBashRunning = $state(false);
  isModelsLoading = $state(false);
  isSettingModel = $state(false);
  error = $state<string | null>(null);
  currentModel = $state("");
  currentProvider = $state("");
  currentThinkingLevel = $state<ThinkingLevel>("off");
  supportsThinking = $state(false);
  persistedSessionId = $state<string | null>(null);
  supportsImageInput = $state(false);
  availableThinkingLevels = $state<ThinkingLevel[]>(["off"]);
  availableModels = $state<AvailableModel[]>([]);
  isSettingThinking = $state(false);
  usageIndicator = $state<UsageIndicatorSnapshot | null>(null);
  isExtensionsLoading = $state(false);
  extensionsLoadError = $state<string | null>(null);
  globalExtensions = $state<RegisteredExtensionSummary[]>([]);
  localExtensions = $state<RegisteredExtensionSummary[]>([]);
  extensionLoadDiagnostics = $state<Array<{ path: string; error: string }>>([]);
  availableSlashCommands = $state<AvailableSlashCommand[]>([]);
  extensionStatuses = $state<ExtensionStatusEntry[]>([]);

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async initialize(): Promise<void> {
    this.sessionStarted = true;
    this.error = null;

    await this.refreshState().catch((error) => {
      console.warn("Failed to refresh initial agent state:", error);
    });
  }

  async refreshState(): Promise<void> {
    const data = await invokeAgentRpc<AgentStateResponseData>(
      "get_state",
      { sessionId: this.sessionId },
      "Failed to get agent state",
    );

    const model = data?.model;
    this.currentModel = typeof model?.id === "string" ? model.id : "";
    this.currentProvider =
      typeof model?.provider === "string" ? model.provider : "";
    this.supportsImageInput = parseModelSupportsImageInput(model?.input);

    this.currentThinkingLevel = parseThinkingLevel(data?.thinkingLevel);
    this.supportsThinking = Boolean(data?.supportsThinking);
    this.persistedSessionId =
      typeof data?.sessionId === "string" && data.sessionId.trim().length > 0
        ? data.sessionId.trim()
        : null;

    this.availableThinkingLevels = parseAvailableThinkingLevels(
      data?.availableThinkingLevels,
    );

    this.usageIndicator = parseUsageIndicator(data?.usageIndicator);
    this.extensionStatuses = parseExtensionStatuses(
      data?.extensionUi?.statuses,
    );

    if (this.availableModels.length > 0) {
      this.availableModels = sortAvailableModels(
        this.availableModels,
        this.currentProvider,
        this.currentModel,
      );

      const selected = this.availableModels.find(
        (candidate) =>
          candidate.provider === this.currentProvider &&
          candidate.id === this.currentModel,
      );
      if (selected) {
        this.supportsImageInput = selected.supportsImageInput;
      }
    }
  }

  async loadAvailableModels(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    this.isModelsLoading = true;

    try {
      const data = await invokeAgentRpc<AvailableModelsResponseData>(
        "get_available_models",
        { sessionId: this.sessionId },
        "Failed to get available models",
      );

      const models = parseAvailableModels(data?.models);
      this.availableModels = sortAvailableModels(
        models,
        this.currentProvider,
        this.currentModel,
      );

      const selected = this.availableModels.find(
        (model) =>
          model.provider === this.currentProvider &&
          model.id === this.currentModel,
      );
      if (selected) {
        this.supportsImageInput = selected.supportsImageInput;
      }
    } catch (error) {
      console.warn("Failed to load models via get_available_models:", error);
      this.availableModels = [];
    } finally {
      this.isModelsLoading = false;
    }
  }

  async loadRegisteredExtensions(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    this.isExtensionsLoading = true;
    this.extensionsLoadError = null;

    try {
      const data = await invokeAgentRpc<RegisteredExtensionsResponseData>(
        "get_registered_extensions",
        { sessionId: this.sessionId },
        "Failed to get registered extensions",
      );

      const parsed = parseRegisteredExtensions(data);
      this.globalExtensions = parsed.global;
      this.localExtensions = parsed.local;
      this.extensionLoadDiagnostics = parsed.errors;
    } catch (error) {
      this.globalExtensions = [];
      this.localExtensions = [];
      this.extensionLoadDiagnostics = [];
      this.extensionsLoadError =
        error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.isExtensionsLoading = false;
    }
  }

  async loadAvailableSlashCommands(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    try {
      const data = await invokeAgentRpc<AvailableSlashCommandsResponseData>(
        "get_commands",
        { sessionId: this.sessionId },
        "Failed to get available commands",
      );

      this.availableSlashCommands = parseAvailableSlashCommands(data?.commands);
    } catch (error) {
      console.warn("Failed to load available slash commands:", error);
      this.availableSlashCommands = [];
    }
  }

  async getSessionTree(): Promise<SessionTreeSnapshot> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const data = await invokeAgentRpc<SessionTreeResponseData>(
      "get_session_tree",
      { sessionId: this.sessionId },
      "Failed to load session tree",
    );

    return parseSessionTreeSnapshot(data);
  }

  async navigateSessionTree(
    targetId: string,
    options?: { summarize?: boolean },
  ): Promise<NavigateSessionTreeResult> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const data = await invokeAgentRpc<NavigateSessionTreeResponseData>(
      "navigate_session_tree",
      {
        sessionId: this.sessionId,
        targetId,
        summarize: options?.summarize === true,
      },
      "Failed to navigate session tree",
    );

    return parseNavigateSessionTreeResult(data);
  }

  async getOAuthProviders(): Promise<OAuthProviderStatus[]> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const data = await invokeAgentRpc<OAuthProvidersResponseData>(
      "get_oauth_providers",
      { sessionId: this.sessionId },
      "Failed to list OAuth providers",
    );

    return parseOAuthProviders(data?.providers);
  }

  async startOAuthLogin(provider: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    await invokeAgentRpc<unknown>(
      "start_oauth_login",
      { provider, sessionId: this.sessionId },
      "Failed to start OAuth login",
    );
  }

  async pollOAuthLogin(): Promise<OAuthLoginPollResult> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const data = await invokeAgentRpc<OAuthLoginPollResponseData>(
      "poll_oauth_login",
      { sessionId: this.sessionId },
      "Failed to poll OAuth login",
    );

    const status = parseOAuthLoginStatus(data?.status);
    const provider =
      typeof data?.provider === "string" ? data.provider : undefined;
    const updates = parseOAuthLoginUpdates(data?.updates);

    return { status, provider, updates };
  }

  async submitOAuthLoginInput(input: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    await invokeAgentRpc<unknown>(
      "submit_oauth_login_input",
      {
        sessionId: this.sessionId,
        input,
      },
      "Failed to submit OAuth login input",
    );
  }

  async cancelOAuthLogin(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    await invokeAgentRpc<unknown>(
      "cancel_oauth_login",
      { sessionId: this.sessionId },
      "Failed to cancel OAuth login",
    );
  }

  async logoutOAuthProvider(provider: string): Promise<boolean> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const data = await invokeAgentRpc<LogoutOAuthProviderResponseData>(
      "logout_oauth_provider",
      {
        provider,
        sessionId: this.sessionId,
      },
      "Failed to logout provider",
    );

    return data?.loggedOut === true;
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    if (!provider || !modelId) {
      throw new Error("Provider and model are required");
    }

    if (provider === this.currentProvider && modelId === this.currentModel) {
      return;
    }

    this.isSettingModel = true;

    try {
      await invokeAgentRpc<unknown>(
        "set_model",
        { provider, modelId, sessionId: this.sessionId },
        "Failed to set model",
      );

      await this.refreshState();
      this.availableModels = sortAvailableModels(
        this.availableModels,
        this.currentProvider,
        this.currentModel,
      );
    } finally {
      this.isSettingModel = false;
    }
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    if (
      !this.supportsThinking ||
      !this.availableThinkingLevels.includes(level)
    ) {
      return;
    }

    if (level === this.currentThinkingLevel) {
      return;
    }

    this.isSettingThinking = true;

    try {
      await invokeAgentRpc<unknown>(
        "set_thinking_level",
        { level, sessionId: this.sessionId },
        "Failed to set thinking level",
      );

      await this.refreshState();
    } finally {
      this.isSettingThinking = false;
    }
  }

  async sendPrompt(
    prompt: string,
    images?: PromptImageAttachment[],
  ): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }
    await invokeAgentCommand(
      "send_prompt",
      {
        prompt,
        sessionId: this.sessionId,
        images,
      },
      "Failed to send prompt",
    );
  }

  async sendBashCommand(
    command: string,
    excludeFromContext = false,
  ): Promise<{
    output: string;
    exitCode?: number;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string;
  }> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    if (this.isBashRunning) {
      throw new Error("A bash command is already running for this session.");
    }

    this.isBashRunning = true;
    this.isLoading = true;

    try {
      const data = await invokeAgentRpc<BashCommandResponseData>(
        "send_bash_command",
        {
          command,
          sessionId: this.sessionId,
          excludeFromContext,
        },
        "Failed to execute bash command",
      );

      return {
        output: typeof data?.output === "string" ? data.output : "",
        exitCode:
          typeof data?.exitCode === "number" && Number.isFinite(data.exitCode)
            ? data.exitCode
            : undefined,
        cancelled: data?.cancelled === true,
        truncated: data?.truncated === true,
        fullOutputPath:
          typeof data?.fullOutputPath === "string"
            ? data.fullOutputPath
            : undefined,
      };
    } finally {
      this.isBashRunning = false;
      this.isLoading = false;
    }
  }

  async abort(): Promise<void> {
    await invokeAgentCommand(
      "abort_agent",
      { sessionId: this.sessionId },
      "Failed to abort agent",
    ).catch(console.error);
    this.isLoading = false;
  }

  async abortBranchSummary(): Promise<void> {
    await invokeAgentCommand(
      "abort_branch_summary",
      { sessionId: this.sessionId },
      "Failed to cancel branch summary",
    ).catch(console.error);
  }

  async abortBash(): Promise<void> {
    await invokeAgentRpc<unknown>(
      "abort_bash",
      { sessionId: this.sessionId },
      "Failed to abort bash command",
    ).catch(console.error);
    this.isBashRunning = false;
    this.isLoading = false;
  }

  applyExtensionStatusUpdate(key: string, text?: string): void {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }

    if (text === undefined) {
      this.extensionStatuses = this.extensionStatuses.filter(
        (entry) => entry.key !== normalizedKey,
      );
      return;
    }

    const next = this.extensionStatuses.filter(
      (entry) => entry.key !== normalizedKey,
    );
    next.push({ key: normalizedKey, text });
    next.sort((a, b) => a.key.localeCompare(b.key));
    this.extensionStatuses = next;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }
}

export function createAgentStore(sessionId: string): AgentStore {
  return new AgentStore(sessionId);
}
