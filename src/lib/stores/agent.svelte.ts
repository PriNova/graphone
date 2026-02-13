import { invoke } from "@tauri-apps/api/core";

// Agent session state
class AgentStore {
  sessionStarted = $state(false);
  isLoading = $state(false);
  error = $state<string | null>(null);
  currentModel = $state("");
  currentProvider = $state("");

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
      return;
    }

    const error = response && typeof response === "object" && "error" in response
      ? response.error
      : "Failed to get agent state";
    throw new Error(error);
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
      return !response.data.cancelled;
    }
    return false;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }
}

export const agentStore = new AgentStore();
