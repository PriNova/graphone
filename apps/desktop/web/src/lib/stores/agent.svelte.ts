import { invoke } from "@tauri-apps/api/core";
import type { PromptImageAttachment } from "$lib/types/agent";

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
  supportsImageInput: boolean;
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

const VALID_THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type UsageContextSeverity = "normal" | "warning" | "error";

export interface UsageIndicatorSnapshot {
  tokenStatsText: string;
  contextText: string;
  fullText: string;
  contextSeverity: UsageContextSeverity;
}

export interface OAuthProviderStatus {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export type OAuthLoginStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type OAuthLoginUpdate =
  | { type: "auth"; url: string; instructions?: string }
  | {
      type: "prompt";
      message: string;
      placeholder?: string;
      allowEmpty: boolean;
      inputType: "prompt" | "manual_code";
    }
  | { type: "progress"; message: string }
  | { type: "complete"; success: boolean; error?: string };

export interface OAuthLoginPollResult {
  status: OAuthLoginStatus;
  provider?: string;
  updates: OAuthLoginUpdate[];
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
    const response = await invoke<
      | {
          success: true;
          data: {
            model?: { id?: unknown; provider?: unknown; input?: unknown };
            thinkingLevel?: unknown;
            supportsThinking?: unknown;
            availableThinkingLevels?: unknown;
            usageIndicator?: unknown;
          };
        }
      | { success: false; error: string }
    >("get_state", { sessionId: this.sessionId });

    if (
      response &&
      typeof response === "object" &&
      "success" in response &&
      response.success
    ) {
      const model = response.data?.model;
      this.currentModel = typeof model?.id === "string" ? model.id : "";
      this.currentProvider =
        typeof model?.provider === "string" ? model.provider : "";
      this.supportsImageInput = this.parseModelSupportsImageInput(model?.input);

      this.currentThinkingLevel = this.parseThinkingLevel(
        response.data?.thinkingLevel,
      );
      this.supportsThinking = Boolean(response.data?.supportsThinking);

      const availableThinkingLevels = response.data?.availableThinkingLevels;
      if (Array.isArray(availableThinkingLevels)) {
        const parsed = availableThinkingLevels
          .map((level) => this.parseThinkingLevel(level))
          .filter(
            (level, index, all): level is ThinkingLevel =>
              VALID_THINKING_LEVELS.has(level) && all.indexOf(level) === index,
          );

        this.availableThinkingLevels = parsed.length > 0 ? parsed : ["off"];
      } else {
        this.availableThinkingLevels = ["off"];
      }

      this.usageIndicator = this.parseUsageIndicator(
        response.data?.usageIndicator,
      );

      if (this.availableModels.length > 0) {
        this.availableModels = this.sortAvailableModels(this.availableModels);

        const selected = this.availableModels.find(
          (candidate) =>
            candidate.provider === this.currentProvider &&
            candidate.id === this.currentModel,
        );
        if (selected) {
          this.supportsImageInput = selected.supportsImageInput;
        }
      }

      return;
    }

    const error =
      response && typeof response === "object" && "error" in response
        ? response.error
        : "Failed to get agent state";
    throw new Error(error);
  }

  async loadAvailableModels(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    this.isModelsLoading = true;

    try {
      const models = await this.loadAvailableModelsViaRpcList();
      this.availableModels = this.sortAvailableModels(models);

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

    const response = await invoke<
      | {
          success: true;
          data: {
            providers: Array<{
              id?: unknown;
              name?: unknown;
              usesCallbackServer?: unknown;
              loggedIn?: unknown;
            }>;
          };
        }
      | { success: false; error: string }
    >("get_oauth_providers", { sessionId: this.sessionId });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to list OAuth providers";
      throw new Error(error);
    }

    const providers = response.data?.providers;
    if (!Array.isArray(providers)) {
      return [];
    }

    return providers
      .map((provider) => {
        if (typeof provider.id !== "string" || provider.id.length === 0) {
          return null;
        }

        return {
          id: provider.id,
          name:
            typeof provider.name === "string" && provider.name.length > 0
              ? provider.name
              : provider.id,
          usesCallbackServer: provider.usesCallbackServer === true,
          loggedIn: provider.loggedIn === true,
        } satisfies OAuthProviderStatus;
      })
      .filter((provider): provider is OAuthProviderStatus => provider !== null);
  }

  async startOAuthLogin(provider: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const response = await invoke<
      { success: true; data?: unknown } | { success: false; error: string }
    >("start_oauth_login", { provider, sessionId: this.sessionId });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to start OAuth login";
      throw new Error(error);
    }
  }

  async pollOAuthLogin(): Promise<OAuthLoginPollResult> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const response = await invoke<
      | {
          success: true;
          data: {
            status?: unknown;
            provider?: unknown;
            updates?: unknown;
          };
        }
      | { success: false; error: string }
    >("poll_oauth_login", { sessionId: this.sessionId });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to poll OAuth login";
      throw new Error(error);
    }

    const status = this.parseOAuthLoginStatus(response.data?.status);
    const provider =
      typeof response.data?.provider === "string"
        ? response.data.provider
        : undefined;
    const updates = this.parseOAuthLoginUpdates(response.data?.updates);

    return { status, provider, updates };
  }

  async submitOAuthLoginInput(input: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const response = await invoke<
      { success: true; data?: unknown } | { success: false; error: string }
    >("submit_oauth_login_input", {
      sessionId: this.sessionId,
      input,
    });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to submit OAuth login input";
      throw new Error(error);
    }
  }

  async cancelOAuthLogin(): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const response = await invoke<
      { success: true; data?: unknown } | { success: false; error: string }
    >("cancel_oauth_login", { sessionId: this.sessionId });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to cancel OAuth login";
      throw new Error(error);
    }
  }

  async logoutOAuthProvider(provider: string): Promise<boolean> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }

    const response = await invoke<
      | { success: true; data?: { loggedOut?: unknown } }
      | { success: false; error: string }
    >("logout_oauth_provider", {
      provider,
      sessionId: this.sessionId,
    });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to logout provider";
      throw new Error(error);
    }

    return response.data?.loggedOut === true;
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
      const response = await invoke<
        { success: true; data?: unknown } | { success: false; error: string }
      >("set_model", { provider, modelId, sessionId: this.sessionId });

      if (
        !(
          response &&
          typeof response === "object" &&
          "success" in response &&
          response.success
        )
      ) {
        const error =
          response && typeof response === "object" && "error" in response
            ? response.error
            : "Failed to set model";
        throw new Error(error);
      }

      await this.refreshState();
      this.availableModels = this.sortAvailableModels(this.availableModels);
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
      const response = await invoke<
        { success: true; data?: unknown } | { success: false; error: string }
      >("set_thinking_level", { level, sessionId: this.sessionId });

      if (
        !(
          response &&
          typeof response === "object" &&
          "success" in response &&
          response.success
        )
      ) {
        const error =
          response && typeof response === "object" && "error" in response
            ? response.error
            : "Failed to set thinking level";
        throw new Error(error);
      }

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
    await invoke("send_prompt", {
      prompt,
      sessionId: this.sessionId,
      images,
    });
  }

  async abort(): Promise<void> {
    await invoke("abort_agent", { sessionId: this.sessionId }).catch(
      console.error,
    );
    this.isLoading = false;
  }

  async newSession(): Promise<boolean> {
    const response = await invoke<
      | { success: true; data: { cancelled: boolean } }
      | { success: false; error: string }
    >("new_session", { sessionId: this.sessionId });

    if (
      response &&
      typeof response === "object" &&
      "success" in response &&
      response.success
    ) {
      await this.refreshState().catch((error) => {
        console.warn("Failed to refresh agent state after new session:", error);
      });
      await this.loadAvailableModels().catch((error) => {
        console.warn("Failed to refresh models after new session:", error);
      });
      return !response.data.cancelled;
    }

    return false;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }

  private async loadAvailableModelsViaRpcList(): Promise<AvailableModel[]> {
    const response = await invoke<
      | {
          success: true;
          data: {
            models: Array<{
              provider?: unknown;
              id?: unknown;
              name?: unknown;
              supportsImageInput?: unknown;
            }>;
          };
        }
      | { success: false; error: string }
    >("get_available_models", { sessionId: this.sessionId });

    if (
      !(
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      )
    ) {
      const error =
        response && typeof response === "object" && "error" in response
          ? response.error
          : "Failed to get available models";
      throw new Error(error);
    }

    const models = response.data?.models;
    if (!Array.isArray(models)) {
      return [];
    }

    return models
      .map((model) => {
        const provider = model.provider;
        const id = model.id;
        const name = model.name;

        if (typeof provider !== "string" || typeof id !== "string") {
          return null;
        }

        return {
          provider,
          id,
          name: typeof name === "string" && name.length > 0 ? name : id,
          supportsImageInput: model.supportsImageInput === true,
        } satisfies AvailableModel;
      })
      .filter((model): model is AvailableModel => model !== null);
  }

  private parseOAuthLoginStatus(status: unknown): OAuthLoginStatus {
    if (
      status === "idle" ||
      status === "running" ||
      status === "awaiting_input" ||
      status === "completed" ||
      status === "failed" ||
      status === "cancelled"
    ) {
      return status;
    }

    return "idle";
  }

  private parseOAuthLoginUpdates(value: unknown): OAuthLoginUpdate[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const updates: OAuthLoginUpdate[] = [];

    for (const candidate of value) {
      if (!candidate || typeof candidate !== "object") {
        continue;
      }

      const update = candidate as {
        type?: unknown;
        url?: unknown;
        instructions?: unknown;
        message?: unknown;
        placeholder?: unknown;
        allowEmpty?: unknown;
        inputType?: unknown;
        success?: unknown;
        error?: unknown;
      };

      if (update.type === "auth" && typeof update.url === "string") {
        updates.push({
          type: "auth",
          url: update.url,
          instructions:
            typeof update.instructions === "string"
              ? update.instructions
              : undefined,
        });
        continue;
      }

      if (update.type === "progress" && typeof update.message === "string") {
        updates.push({ type: "progress", message: update.message });
        continue;
      }

      if (update.type === "prompt" && typeof update.message === "string") {
        updates.push({
          type: "prompt",
          message: update.message,
          placeholder:
            typeof update.placeholder === "string"
              ? update.placeholder
              : undefined,
          allowEmpty: update.allowEmpty === true,
          inputType:
            update.inputType === "manual_code" ? "manual_code" : "prompt",
        });
        continue;
      }

      if (update.type === "complete") {
        updates.push({
          type: "complete",
          success: update.success === true,
          error: typeof update.error === "string" ? update.error : undefined,
        });
      }
    }

    return updates;
  }

  private parseThinkingLevel(level: unknown): ThinkingLevel {
    if (typeof level !== "string") {
      return "off";
    }

    const normalized = level.toLowerCase() as ThinkingLevel;
    return VALID_THINKING_LEVELS.has(normalized) ? normalized : "off";
  }

  private parseModelSupportsImageInput(input: unknown): boolean {
    if (!Array.isArray(input)) {
      return false;
    }

    return input.some((value) => value === "image");
  }

  private parseUsageIndicator(value: unknown): UsageIndicatorSnapshot | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const source = value as {
      tokenStatsText?: unknown;
      contextText?: unknown;
      fullText?: unknown;
      contextSeverity?: unknown;
    };

    const tokenStatsText =
      typeof source.tokenStatsText === "string" ? source.tokenStatsText : "";
    const contextText =
      typeof source.contextText === "string" ? source.contextText : "";
    const fullText = typeof source.fullText === "string" ? source.fullText : "";

    if (!tokenStatsText && !contextText && !fullText) {
      return null;
    }

    return {
      tokenStatsText,
      contextText,
      fullText:
        fullText || [tokenStatsText, contextText].filter(Boolean).join(" "),
      contextSeverity: this.parseUsageContextSeverity(source.contextSeverity),
    };
  }

  private parseUsageContextSeverity(value: unknown): UsageContextSeverity {
    if (value === "warning" || value === "error" || value === "normal") {
      return value;
    }

    return "normal";
  }

  private sortAvailableModels(models: AvailableModel[]): AvailableModel[] {
    const currentProvider = this.currentProvider;
    const currentModel = this.currentModel;

    return [...models].sort((a, b) => {
      const aIsCurrent =
        a.provider === currentProvider && a.id === currentModel;
      const bIsCurrent =
        b.provider === currentProvider && b.id === currentModel;

      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;

      const providerCompare = a.provider.localeCompare(b.provider);
      if (providerCompare !== 0) return providerCompare;

      return a.id.localeCompare(b.id);
    });
  }
}

export function createAgentStore(sessionId: string): AgentStore {
  return new AgentStore(sessionId);
}
