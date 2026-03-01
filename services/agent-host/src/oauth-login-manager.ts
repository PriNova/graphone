import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

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

interface PendingOAuthInput {
  allowEmpty: boolean;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

interface OAuthLoginFlow {
  sessionId: string;
  providerId: string;
  status: Exclude<OAuthLoginStatus, "idle" | "awaiting_input">;
  updates: OAuthLoginUpdate[];
  pendingInput?: PendingOAuthInput;
  abortController: AbortController;
}

export class OAuthLoginManager {
  private readonly oauthLoginFlows = new Map<string, OAuthLoginFlow>();

  constructor(
    private readonly authStorage: AuthStorage,
    private readonly modelRegistry: ModelRegistry,
  ) {}

  start(
    sessionId: string,
    providerId: string,
  ): { started: boolean; provider: string; providerName: string } {
    const normalizedProvider = providerId.trim();
    if (!normalizedProvider) {
      throw new Error("provider must be a non-empty string");
    }

    const provider = this.authStorage
      .getOAuthProviders()
      .find((candidate) => candidate.id === normalizedProvider);

    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${normalizedProvider}`);
    }

    const existingFlow = this.oauthLoginFlows.get(sessionId);
    if (
      existingFlow &&
      existingFlow.status !== "completed" &&
      existingFlow.status !== "failed" &&
      existingFlow.status !== "cancelled"
    ) {
      throw new Error(
        `An OAuth login flow is already active for session ${sessionId}`,
      );
    }

    const flow: OAuthLoginFlow = {
      sessionId,
      providerId: provider.id,
      status: "running",
      updates: [],
      abortController: new AbortController(),
    };

    this.oauthLoginFlows.set(sessionId, flow);
    this.runOAuthLoginFlow(flow);

    return {
      started: true,
      provider: provider.id,
      providerName: provider.name,
    };
  }

  poll(sessionId: string): {
    status: OAuthLoginStatus;
    provider?: string;
    updates: OAuthLoginUpdate[];
  } {
    const flow = this.oauthLoginFlows.get(sessionId);
    if (!flow) {
      return { status: "idle", updates: [] };
    }

    const updates = flow.updates.splice(0, flow.updates.length);
    const status: OAuthLoginStatus = flow.pendingInput
      ? "awaiting_input"
      : flow.status;

    if (
      flow.status !== "running" &&
      !flow.pendingInput &&
      flow.updates.length === 0
    ) {
      this.oauthLoginFlows.delete(sessionId);
    }

    return {
      status,
      provider: flow.providerId,
      updates,
    };
  }

  submitInput(sessionId: string, input: string): { accepted: boolean } {
    const flow = this.oauthLoginFlows.get(sessionId);
    if (!flow) {
      throw new Error("No OAuth login flow is active");
    }

    const pending = flow.pendingInput;
    if (!pending) {
      throw new Error("OAuth login is not waiting for input");
    }

    if (!pending.allowEmpty && input.trim().length === 0) {
      throw new Error("Input cannot be empty for this OAuth step");
    }

    flow.pendingInput = undefined;
    pending.resolve(input);
    return { accepted: true };
  }

  cancel(sessionId: string): { cancelled: boolean } {
    const flow = this.oauthLoginFlows.get(sessionId);
    if (!flow) {
      return { cancelled: false };
    }

    flow.abortController.abort();

    if (flow.pendingInput) {
      const pending = flow.pendingInput;
      flow.pendingInput = undefined;
      pending.reject(new Error("Login cancelled"));
    }

    return { cancelled: true };
  }

  disposeSession(sessionId: string): void {
    const flow = this.oauthLoginFlows.get(sessionId);
    if (!flow) {
      return;
    }

    flow.abortController.abort();
    flow.pendingInput?.reject(new Error("Login cancelled"));
    this.oauthLoginFlows.delete(sessionId);
  }

  shutdown(): void {
    for (const flow of this.oauthLoginFlows.values()) {
      flow.abortController.abort();
      flow.pendingInput?.reject(new Error("Login cancelled"));
    }
    this.oauthLoginFlows.clear();
  }

  private runOAuthLoginFlow(flow: OAuthLoginFlow): void {
    void (async () => {
      try {
        await this.authStorage.login(flow.providerId, {
          onAuth: (info) => {
            flow.updates.push({
              type: "auth",
              url: info.url,
              instructions:
                typeof info.instructions === "string"
                  ? info.instructions
                  : undefined,
            });
          },
          onPrompt: async (prompt) =>
            this.requestOAuthInput(flow, prompt, "prompt"),
          onProgress: (message) => {
            if (message.trim().length === 0) {
              return;
            }
            flow.updates.push({ type: "progress", message });
          },
          onManualCodeInput: async () =>
            this.requestOAuthInput(
              flow,
              {
                message: "Paste redirect URL below:",
                allowEmpty: false,
              },
              "manual_code",
            ),
          signal: flow.abortController.signal,
        });

        this.modelRegistry.refresh();
        this.clearPendingOAuthInput(flow);
        flow.status = "completed";
        flow.updates.push({ type: "complete", success: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cancelled =
          flow.abortController.signal.aborted || message === "Login cancelled";

        this.clearPendingOAuthInput(flow);
        flow.status = cancelled ? "cancelled" : "failed";
        flow.updates.push({
          type: "complete",
          success: false,
          error: cancelled ? "Login cancelled" : message,
        });
      }
    })();
  }

  private clearPendingOAuthInput(flow: OAuthLoginFlow): void {
    const pending = flow.pendingInput;
    if (!pending) {
      return;
    }

    flow.pendingInput = undefined;
    pending.resolve("");
  }

  private requestOAuthInput(
    flow: OAuthLoginFlow,
    prompt: { message: string; placeholder?: string; allowEmpty?: boolean },
    inputType: "prompt" | "manual_code",
  ): Promise<string> {
    if (flow.abortController.signal.aborted) {
      throw new Error("Login cancelled");
    }

    if (flow.pendingInput) {
      throw new Error("OAuth login is already waiting for input");
    }

    const allowEmpty = prompt.allowEmpty === true;

    flow.updates.push({
      type: "prompt",
      message: prompt.message,
      placeholder:
        typeof prompt.placeholder === "string" ? prompt.placeholder : undefined,
      allowEmpty,
      inputType,
    });

    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        if (!flow.pendingInput) {
          return;
        }

        flow.pendingInput = undefined;
        reject(new Error("Login cancelled"));
      };

      flow.abortController.signal.addEventListener("abort", onAbort, {
        once: true,
      });

      flow.pendingInput = {
        allowEmpty,
        resolve: (value) => {
          flow.abortController.signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        reject: (error) => {
          flow.abortController.signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      };
    });
  }
}
