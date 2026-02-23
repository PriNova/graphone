import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

import type { HostedSession } from "./session-runtime.js";
import type { HostedSessionInfo, SessionEventEnvelope } from "./protocol.js";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

type ContextSeverity = "normal" | "warning" | "error";

interface UsageIndicatorSnapshot {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  usingSubscription: boolean;
  contextPercent: number | null;
  contextWindow: number;
  autoCompactionEnabled: boolean;
  tokenStatsText: string;
  contextText: string;
  fullText: string;
  contextSeverity: ContextSeverity;
}

type OAuthLoginStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

type OAuthLoginUpdate =
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

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export class HostRuntime {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = new ModelRegistry(this.authStorage);
  private readonly oauthLoginFlows = new Map<string, OAuthLoginFlow>();

  constructor(
    private readonly emitSessionEvent: (event: SessionEventEnvelope) => void,
  ) {}

  async createSession(args: {
    sessionId?: string;
    cwd: string;
    provider?: string;
    modelId?: string;
    sessionFile?: string;
  }): Promise<{
    sessionId: string;
    cwd: string;
    modelFallbackMessage?: string;
    sessionFile?: string;
  }> {
    const sessionId = (args.sessionId?.trim() || randomUUID()).trim();
    if (!sessionId) {
      throw new Error("sessionId cannot be empty");
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      return {
        sessionId: existing.sessionId,
        cwd: existing.cwd,
      };
    }

    const fallbackCwd = this.validateCwd(args.cwd);

    const sessionManager = args.sessionFile
      ? SessionManager.open(this.validateSessionFile(args.sessionFile))
      : SessionManager.create(fallbackCwd);

    const resolvedCwd = this.validateCwd(sessionManager.getCwd());

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: resolvedCwd,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    const unsubscribe = session.subscribe((event) => {
      this.emitSessionEvent({
        type: "session_event",
        sessionId,
        event: this.compactSessionEventForWire(event),
      });
    });

    this.sessions.set(sessionId, {
      sessionId,
      cwd: resolvedCwd,
      createdAt: Date.now(),
      session,
      unsubscribe,
    });

    if (args.provider && args.modelId) {
      try {
        await this.setModel(sessionId, args.provider, args.modelId);
      } catch (error) {
        await this.closeSession(sessionId);
        throw error;
      }
    }

    return {
      sessionId,
      cwd: resolvedCwd,
      modelFallbackMessage,
      sessionFile: session.sessionFile,
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }

    hosted.unsubscribe();
    hosted.session.dispose();
    this.sessions.delete(sessionId);

    const flow = this.oauthLoginFlows.get(sessionId);
    if (flow) {
      flow.abortController.abort();
      flow.pendingInput?.reject(new Error("Login cancelled"));
      this.oauthLoginFlows.delete(sessionId);
    }
  }

  listSessions(): HostedSessionInfo[] {
    return Array.from(this.sessions.values())
      .map((hosted) => this.toSessionInfo(hosted))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async prompt(
    sessionId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<void> {
    const session = this.requireSession(sessionId, "prompt");

    // Fire-and-forget to keep prompt acknowledgements immediate,
    // matching RPC mode behavior where streaming continues via events.
    session
      .prompt(message, {
        images,
        streamingBehavior,
        source: "rpc",
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[pi-agent-host] prompt failed for session ${sessionId}: ${message}`,
        );
      });
  }

  async steer(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "steer");
    await session.steer(message, images);
  }

  async followUp(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "follow_up");
    await session.followUp(message, images);
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId, "abort");
    await session.abort();
  }

  async newSession(sessionId: string): Promise<{ cancelled: boolean }> {
    const session = this.requireSession(sessionId, "new_session");
    const cancelled = !(await session.newSession());
    return { cancelled };
  }

  getMessages(sessionId: string): { messages: AgentSession["messages"] } {
    const session = this.requireSession(sessionId, "get_messages");
    return {
      messages: session.messages,
    };
  }

  getState(sessionId: string): {
    model?: unknown;
    thinkingLevel: string;
    supportsThinking: boolean;
    availableThinkingLevels: ThinkingLevel[];
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
    sessionFile?: string;
    sessionId: string;
    sessionName?: string;
    autoCompactionEnabled: boolean;
    messageCount: number;
    pendingMessageCount: number;
    usageIndicator: UsageIndicatorSnapshot;
  } {
    const session = this.requireSession(sessionId, "get_state");
    return {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      supportsThinking: session.supportsThinking(),
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount,
      usageIndicator: this.buildUsageIndicator(session),
    };
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<unknown> {
    const session = this.requireSession(sessionId, "set_model");
    const models = await session.modelRegistry.getAvailable();
    const model = models.find(
      (m) => m.provider === provider && m.id === modelId,
    );

    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }

    await session.setModel(model);
    return model;
  }

  async cycleModel(sessionId: string): Promise<unknown | null> {
    const session = this.requireSession(sessionId, "cycle_model");
    return (await session.cycleModel()) ?? null;
  }

  setThinkingLevel(
    sessionId: string,
    level: string,
  ): {
    level: ThinkingLevel;
    supportsThinking: boolean;
    availableThinkingLevels: ThinkingLevel[];
  } {
    const session = this.requireSession(sessionId, "set_thinking_level");
    const normalized = level.trim().toLowerCase();

    if (!THINKING_LEVELS.has(normalized as ThinkingLevel)) {
      throw new Error(
        `Invalid thinking level: ${level}. Valid levels: off, minimal, low, medium, high, xhigh`,
      );
    }

    session.setThinkingLevel(normalized as ThinkingLevel);

    return {
      level: session.thinkingLevel,
      supportsThinking: session.supportsThinking(),
      availableThinkingLevels: session.getAvailableThinkingLevels(),
    };
  }

  async getAvailableModels(): Promise<{
    models: Array<{
      provider: string;
      id: string;
      name: string;
      supportsImageInput: boolean;
    }>;
  }> {
    const models = await this.modelRegistry.getAvailable();

    return {
      models: models.map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name || model.id,
        supportsImageInput: (model.input ?? []).includes("image"),
      })),
    };
  }

  listOAuthProviders(sessionId: string): {
    providers: Array<{
      id: string;
      name: string;
      usesCallbackServer: boolean;
      loggedIn: boolean;
    }>;
  } {
    this.requireSession(sessionId, "oauth_list_providers");

    const providers = this.authStorage.getOAuthProviders();
    return {
      providers: providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        usesCallbackServer: provider.usesCallbackServer === true,
        loggedIn: this.authStorage.get(provider.id)?.type === "oauth",
      })),
    };
  }

  startOAuthLogin(
    sessionId: string,
    providerId: string,
  ): { started: boolean; provider: string; providerName: string } {
    this.requireSession(sessionId, "oauth_start_login");

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

  pollOAuthLogin(sessionId: string): {
    status: OAuthLoginStatus;
    provider?: string;
    updates: OAuthLoginUpdate[];
  } {
    this.requireSession(sessionId, "oauth_poll_login");

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

  submitOAuthLoginInput(
    sessionId: string,
    input: string,
  ): { accepted: boolean } {
    this.requireSession(sessionId, "oauth_submit_login_input");

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

  cancelOAuthLogin(sessionId: string): { cancelled: boolean } {
    this.requireSession(sessionId, "oauth_cancel_login");

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

  logoutOAuthProvider(
    sessionId: string,
    providerId: string,
  ): { provider: string; providerName: string; loggedOut: boolean } {
    this.requireSession(sessionId, "oauth_logout");

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

    const wasLoggedIn =
      this.authStorage.get(normalizedProvider)?.type === "oauth";

    if (wasLoggedIn) {
      this.authStorage.logout(normalizedProvider);
      this.modelRegistry.refresh();
    }

    return {
      provider: normalizedProvider,
      providerName: provider.name,
      loggedOut: wasLoggedIn,
    };
  }

  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }

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

  private buildUsageIndicator(session: AgentSession): UsageIndicatorSnapshot {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;

    for (const entry of session.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") {
        continue;
      }

      const assistantMessage = entry.message as AssistantMessage;
      const usage = assistantMessage.usage;
      if (!usage) {
        continue;
      }

      totalInput += usage.input;
      totalOutput += usage.output;
      totalCacheRead += usage.cacheRead;
      totalCacheWrite += usage.cacheWrite;
      totalCost += usage.cost.total;
    }

    const contextUsage = session.getContextUsage();
    const contextWindow =
      contextUsage?.contextWindow ?? session.model?.contextWindow ?? 0;
    const contextPercentValue = contextUsage?.percent ?? 0;
    const contextPercentDisplay =
      contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

    const usingSubscription = session.model
      ? session.modelRegistry.isUsingOAuth(session.model)
      : false;

    const tokenParts: string[] = [];
    if (totalInput) tokenParts.push(`↑${formatTokens(totalInput)}`);
    if (totalOutput) tokenParts.push(`↓${formatTokens(totalOutput)}`);
    if (totalCacheRead) tokenParts.push(`R${formatTokens(totalCacheRead)}`);
    if (totalCacheWrite) tokenParts.push(`W${formatTokens(totalCacheWrite)}`);
    if (totalCost || usingSubscription) {
      tokenParts.push(
        `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
      );
    }

    const autoIndicator = session.autoCompactionEnabled ? " (auto)" : "";
    const contextText =
      contextPercentDisplay === "?"
        ? `?/${formatTokens(contextWindow)}${autoIndicator}`
        : `${contextPercentDisplay}%/${formatTokens(contextWindow)}${autoIndicator}`;

    const tokenStatsText = tokenParts.join(" ");
    const fullText = tokenStatsText
      ? `${tokenStatsText} ${contextText}`
      : contextText;

    const contextSeverity: ContextSeverity =
      contextPercentValue > 90
        ? "error"
        : contextPercentValue > 70
          ? "warning"
          : "normal";

    return {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      usingSubscription,
      contextPercent: contextUsage?.percent ?? null,
      contextWindow,
      autoCompactionEnabled: session.autoCompactionEnabled,
      tokenStatsText,
      contextText,
      fullText,
      contextSeverity,
    };
  }

  private compactSessionEventForWire(event: unknown): unknown {
    if (!event || typeof event !== "object") {
      return event;
    }

    const eventType = (event as { type?: unknown }).type;
    if (eventType === "agent_end") {
      return { type: "agent_end" };
    }

    return event;
  }

  private toSessionInfo(hosted: HostedSession): HostedSessionInfo {
    const model = hosted.session.model
      ? { provider: hosted.session.model.provider, id: hosted.session.model.id }
      : undefined;

    return {
      sessionId: hosted.sessionId,
      cwd: hosted.cwd,
      createdAt: hosted.createdAt,
      model,
      busy: hosted.session.isStreaming,
      sessionFile: hosted.session.sessionFile,
    };
  }

  private requireSession(
    sessionId: string | undefined,
    command: string,
  ): AgentSession {
    const normalized = sessionId?.trim();
    if (!normalized) {
      throw new Error(`sessionId is required for ${command}`);
    }

    const hosted = this.sessions.get(normalized);
    if (!hosted) {
      throw new Error(`Unknown sessionId: ${normalized}`);
    }

    return hosted.session;
  }

  private validateCwd(cwd: string): string {
    const normalized = resolve(cwd);

    if (!existsSync(normalized)) {
      throw new Error(`Directory does not exist: ${normalized}`);
    }

    const stats = statSync(normalized);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${normalized}`);
    }

    return normalized;
  }

  private validateSessionFile(sessionFile: string): string {
    const normalized = resolve(sessionFile);

    if (!existsSync(normalized)) {
      throw new Error(`Session file does not exist: ${normalized}`);
    }

    const stats = statSync(normalized);
    if (!stats.isFile()) {
      throw new Error(`Session file path is not a file: ${normalized}`);
    }

    return normalized;
  }
}
