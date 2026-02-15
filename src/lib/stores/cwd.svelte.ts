import { invoke } from "@tauri-apps/api/core";

interface CwdState {
  cwd: string | null;
  loading: boolean;
  error: string | null;
}

class CwdStore {
  // Svelte 5 runes state
  #state = $state<CwdState>({
    cwd: null,
    loading: false,
    error: null,
  });

  get cwd(): string | null {
    return this.#state.cwd;
  }

  get loading(): boolean {
    return this.#state.loading;
  }

  get error(): string | null {
    return this.#state.error;
  }

  async load(): Promise<void> {
    if (this.#state.cwd !== null || this.#state.loading) {
      return;
    }

    this.#state.loading = true;
    this.#state.error = null;

    try {
      const result = await invoke<string>("get_working_directory");
      this.#state.cwd = result;
    } catch (e) {
      this.#state.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.#state.loading = false;
    }
  }
}

export const cwdStore = new CwdStore();
