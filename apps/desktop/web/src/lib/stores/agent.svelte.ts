import type { PromptImageAttachment } from "$lib/types/agent";
import { invokeAgentCommand, invokeAgentRpc } from "$lib/stores/agent/api";
import {
  parseAvailableModels,
  parseAvailableThinkingLevels,
  parseModelSupportsImageInput,
  parseOAuthLoginStatus,
  parseOAuthLoginUpdates,
  parseOAuthProviders,
  parseThinkingLevel,
  parseUsageIndicator,
  sortAvailableModels,
} from "$lib/stores/agent/parsers";
import type {
  AvailableModel,
  OAuthLoginPollResult,
  OAuthProviderStatus,
  ThinkingLevel,
  UsageIndicatorSnapshot,
} from "$lib/stores/agent/types";

export type {
  AvailableModel,
  OAuthLoginPollResult,
  OAuthLoginStatus,
  OAuthLoginUpdate,
  OAuthProviderStatus,
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

interface NewSessionResponseData {
  cancelled?: unknown;
}

// Agent session state (session-scoped)
export class AgentStore {
  readonly sessionId: string;

  sessionStarted = $state(false);
  isLoading = $state(false);
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

  async abort(): Promise<void> {
    await invokeAgentCommand(
      "abort_agent",
      { sessionId: this.sessionId },
      "Failed to abort agent",
    ).catch(console.error);
    this.isLoading = false;
  }

  async newSession(): Promise<boolean> {
    try {
      const data = await invokeAgentRpc<NewSessionResponseData>(
        "new_session",
        { sessionId: this.sessionId },
        "Failed to create new session",
      );

      await this.refreshState().catch((error) => {
        console.warn("Failed to refresh agent state after new session:", error);
      });
      await this.loadAvailableModels().catch((error) => {
        console.warn("Failed to refresh models after new session:", error);
      });
      return data?.cancelled !== true;
    } catch {
      return false;
    }
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }
}

export function createAgentStore(sessionId: string): AgentStore {
  return new AgentStore(sessionId);
}
