import { invoke } from "@tauri-apps/api/core";

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
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
            model?: { id?: unknown; provider?: unknown };
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
    } catch (error) {
      console.warn("Failed to load models via get_available_models:", error);
      this.availableModels = [];
    } finally {
      this.isModelsLoading = false;
    }
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

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error("Agent session not started");
    }
    await invoke("send_prompt", { prompt, sessionId: this.sessionId });
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
            models: Array<{ provider?: unknown; id?: unknown; name?: unknown }>;
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
        } satisfies AvailableModel;
      })
      .filter((model): model is AvailableModel => model !== null);
  }

  private parseThinkingLevel(level: unknown): ThinkingLevel {
    if (typeof level !== "string") {
      return "off";
    }

    const normalized = level.toLowerCase() as ThinkingLevel;
    return VALID_THINKING_LEVELS.has(normalized) ? normalized : "off";
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
