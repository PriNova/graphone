import { invoke } from "@tauri-apps/api/core";

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
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
  availableModels = $state<AvailableModel[]>([]);

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
          data: { model?: { id?: unknown; provider?: unknown } };
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
