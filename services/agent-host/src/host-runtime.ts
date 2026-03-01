import { randomUUID } from "node:crypto";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

import {
  OAuthLoginManager,
  type OAuthLoginStatus,
  type OAuthLoginUpdate,
} from "./oauth-login-manager.js";
import type { HostedSessionInfo, SessionEventEnvelope } from "./protocol.js";
import type { HostedSession } from "./session-runtime.js";
import { validateCwd, validateSessionFile } from "./session-validation.js";
import {
  buildUsageIndicator,
  type UsageIndicatorSnapshot,
} from "./usage-indicator.js";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export class HostRuntime {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = new ModelRegistry(this.authStorage);
  private readonly oauthLoginManager = new OAuthLoginManager(
    this.authStorage,
    this.modelRegistry,
  );

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

    const fallbackCwd = validateCwd(args.cwd);

    const sessionManager = args.sessionFile
      ? SessionManager.open(validateSessionFile(args.sessionFile))
      : SessionManager.create(fallbackCwd);

    const resolvedCwd = validateCwd(sessionManager.getCwd());

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
    this.oauthLoginManager.disposeSession(sessionId);
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
      usageIndicator: buildUsageIndicator(session),
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
    return this.oauthLoginManager.start(sessionId, providerId);
  }

  pollOAuthLogin(sessionId: string): {
    status: OAuthLoginStatus;
    provider?: string;
    updates: OAuthLoginUpdate[];
  } {
    this.requireSession(sessionId, "oauth_poll_login");
    return this.oauthLoginManager.poll(sessionId);
  }

  submitOAuthLoginInput(
    sessionId: string,
    input: string,
  ): { accepted: boolean } {
    this.requireSession(sessionId, "oauth_submit_login_input");
    return this.oauthLoginManager.submitInput(sessionId, input);
  }

  cancelOAuthLogin(sessionId: string): { cancelled: boolean } {
    this.requireSession(sessionId, "oauth_cancel_login");
    return this.oauthLoginManager.cancel(sessionId);
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

    this.oauthLoginManager.shutdown();
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
}
