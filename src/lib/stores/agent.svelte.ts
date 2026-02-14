import { invoke } from "@tauri-apps/api/core";

export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
}

// Agent session state
class AgentStore {
  sessionStarted = $state(false);
  isLoading = $state(false);
  isModelsLoading = $state(false);
  isSettingModel = $state(false);
  error = $state<string | null>(null);
  currentModel = $state("");
  currentProvider = $state("");
  availableModels = $state<AvailableModel[]>([]);

  async startSession(): Promise<void> {
    // Already started - nothing to do
    if (this.sessionStarted) {
      return;
    }

    try {
      await invoke("start_agent_session");
      this.sessionStarted = true;
      this.error = null;
      await this.refreshState().catch((error) => {
        console.warn("Failed to refresh initial agent state:", error);
      });
    } catch (err) {
      console.error("Failed to start agent session:", err);
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async refreshState(): Promise<void> {
    const response = await invoke<
      { success: true; data: { model?: { id?: unknown; provider?: unknown } } } | { success: false; error: string }
    >("get_state");

    if (response && typeof response === "object" && "success" in response && response.success) {
      const model = response.data?.model;
      this.currentModel = typeof model?.id === "string" ? model.id : "";
      this.currentProvider = typeof model?.provider === "string" ? model.provider : "";

      if (this.availableModels.length > 0) {
        this.availableModels = this.sortAvailableModels(this.availableModels);
      }

      return;
    }

    const error = response && typeof response === "object" && "error" in response
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
      let models: AvailableModel[] = [];

      // First try: Load all models from static embedded data (fastest)
      // This uses the Rust command that bypasses sidecar IPC
      try {
        models = await this.loadAvailableModelsFromStatic();
        if (models.length > 0) {
          console.log(`Loaded ${models.length} models from static data`);
        }
      } catch (error) {
        console.warn("Failed to load models from static data:", error);
      }

      // If no models from static data, try RPC method
      if (models.length === 0) {
        try {
          models = await this.loadAvailableModelsViaRpcList();
        } catch (error) {
          console.warn(
            "Failed to load models via get_available_models (likely large payload / IPC limits). Falling back to cycle_model enumeration:",
            error,
          );
          models = await this.loadAvailableModelsByCycling();
        }
      }

      this.availableModels = this.sortAvailableModels(models);
    } finally {
      this.isModelsLoading = false;
    }
  }

  private async loadAvailableModelsFromStatic(): Promise<AvailableModel[]> {
    // Use the new static models command that embeds model list in the binary
    // This avoids the 64KB pipe buffer limit issue on Linux
    const models = await invoke<AvailableModel[]>("get_static_models");
    return models;
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
      >("set_model", { provider, modelId });

      if (!(response && typeof response === "object" && "success" in response && response.success)) {
        const error = response && typeof response === "object" && "error" in response
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
    await invoke("send_prompt", { prompt });
  }

  async abort(): Promise<void> {
    await invoke("abort_agent").catch(console.error);
    this.isLoading = false;
  }

  async newSession(): Promise<boolean> {
    const response = await invoke<
      { success: true; data: { cancelled: boolean } } | { success: false; error: string }
    >("new_session");

    if (response && typeof response === "object" && "success" in response && response.success) {
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
      | { success: true; data: { models: Array<{ provider?: unknown; id?: unknown; name?: unknown }> } }
      | { success: false; error: string }
    >("get_available_models");

    if (!(response && typeof response === "object" && "success" in response && response.success)) {
      const error = response && typeof response === "object" && "error" in response
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

  private async loadAvailableModelsByCycling(): Promise<AvailableModel[]> {
    await this.refreshState().catch(() => undefined);

    const originalProvider = this.currentProvider;
    const originalModel = this.currentModel;

    if (!originalProvider || !originalModel) {
      return [];
    }

    const originalKey = `${originalProvider}/${originalModel}`;
    const discovered = new Map<string, AvailableModel>();
    discovered.set(originalKey, {
      provider: originalProvider,
      id: originalModel,
      name: originalModel,
    });

    const maxIterations = 2000;

    try {
      for (let i = 0; i < maxIterations; i++) {
        const response = await invoke<
          | { success: true; data: { model?: { provider?: unknown; id?: unknown; name?: unknown } } | null }
          | { success: false; error: string }
        >("cycle_model");

        if (!(response && typeof response === "object" && "success" in response && response.success)) {
          const error = response && typeof response === "object" && "error" in response
            ? response.error
            : "Failed to cycle model";
          throw new Error(error);
        }

        const data = response.data;
        if (!data || typeof data !== "object" || !("model" in data) || !data.model || typeof data.model !== "object") {
          break;
        }

        const typedModel = data.model as { provider?: unknown; id?: unknown; name?: unknown };
        if (typeof typedModel.provider !== "string" || typeof typedModel.id !== "string") {
          continue;
        }

        const key = `${typedModel.provider}/${typedModel.id}`;
        if (key === originalKey || discovered.has(key)) {
          break;
        }

        discovered.set(key, {
          provider: typedModel.provider,
          id: typedModel.id,
          name: typeof typedModel.name === "string" && typedModel.name.length > 0
            ? typedModel.name
            : typedModel.id,
        });
      }

      return [...discovered.values()];
    } finally {
      await invoke("set_model", { provider: originalProvider, modelId: originalModel }).catch(() => undefined);
      await this.refreshState().catch(() => undefined);
    }
  }

  private sortAvailableModels(models: AvailableModel[]): AvailableModel[] {
    const currentProvider = this.currentProvider;
    const currentModel = this.currentModel;

    return [...models].sort((a, b) => {
      const aIsCurrent = a.provider === currentProvider && a.id === currentModel;
      const bIsCurrent = b.provider === currentProvider && b.id === currentModel;

      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;

      const providerCompare = a.provider.localeCompare(b.provider);
      if (providerCompare !== 0) return providerCompare;

      return a.id.localeCompare(b.id);
    });
  }
}

export const agentStore = new AgentStore();
