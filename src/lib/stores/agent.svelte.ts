import { invoke } from "@tauri-apps/api/core";

// Configuration for the AI model
export const MODEL_CONFIG = {
  provider: "cline",
  model: "moonshotai/kimi-k2.5"
};

// Agent session state
class AgentStore {
  sessionStarted = $state(false);
  isLoading = $state(false);
  error = $state<string | null>(null);

  async startSession(): Promise<void> {
    // Already started - nothing to do
    if (this.sessionStarted) {
      return;
    }
    
    try {
      console.log('Starting agent session with config:', MODEL_CONFIG);
      await invoke("start_agent_session", {
        provider: MODEL_CONFIG.provider,
        model: MODEL_CONFIG.model
      });
      console.log('Agent session started successfully');
      this.sessionStarted = true;
      this.error = null;
    } catch (err) {
      console.error('Failed to start agent session:', err);
      this.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  async sendPrompt(prompt: string): Promise<void> {
    if (!this.sessionStarted) {
      throw new Error('Agent session not started');
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
    
    if (response && typeof response === 'object' && 'success' in response && response.success) {
      return !response.data.cancelled;
    }
    return false;
  }

  setLoading(loading: boolean): void {
    this.isLoading = loading;
  }
}

export const agentStore = new AgentStore();
