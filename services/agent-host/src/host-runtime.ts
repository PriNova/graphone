import { randomUUID } from "node:crypto";
import { basename, dirname, extname, resolve } from "node:path";

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

type ResourceScope = "user" | "project" | "temporary";
type ResourceOrigin = "package" | "top-level";

interface ExtensionPathMetadata {
  source: string;
  scope: ResourceScope;
  origin: ResourceOrigin;
}

interface RegisteredExtensionSummary {
  name: string;
  path: string;
  resolvedPath: string;
  scope: "global" | "local";
  source: string;
  origin: ResourceOrigin | "unknown";
  toolCount: number;
  commandCount: number;
}

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

  getRegisteredExtensions(sessionId: string): {
    global: RegisteredExtensionSummary[];
    local: RegisteredExtensionSummary[];
    errors: Array<{ path: string; error: string }>;
  } {
    const session = this.requireSession(sessionId, "get_registered_extensions");
    const extensionsResult = session.resourceLoader.getExtensions();
    const pathMetadata = session.resourceLoader.getPathMetadata();

    const summaries = extensionsResult.extensions.map((extension) => {
      const metadata = this.getExtensionMetadata(extension, pathMetadata);
      const scope = this.mapScopeToGroup(metadata?.scope);

      return {
        name: this.getExtensionDisplayName(extension.path, metadata),
        path: extension.path,
        resolvedPath: extension.resolvedPath,
        scope,
        source: metadata?.source ?? "unknown",
        origin: metadata?.origin ?? "unknown",
        toolCount: extension.tools.size,
        commandCount: extension.commands.size,
      } satisfies RegisteredExtensionSummary;
    });

    const sorted = summaries.sort((a, b) =>
      a.resolvedPath.localeCompare(b.resolvedPath),
    );

    return {
      global: sorted.filter((extension) => extension.scope === "global"),
      local: sorted.filter((extension) => extension.scope === "local"),
      errors: extensionsResult.errors,
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

  private getExtensionMetadata(
    extension: { path: string; resolvedPath: string },
    pathMetadata: Map<string, unknown>,
  ): ExtensionPathMetadata | undefined {
    const candidates = new Set<string>();

    if (extension.path) {
      candidates.add(extension.path);
      candidates.add(resolve(extension.path));
    }

    if (extension.resolvedPath) {
      candidates.add(extension.resolvedPath);
      candidates.add(resolve(extension.resolvedPath));
    }

    for (const candidate of candidates) {
      const metadata = pathMetadata.get(candidate);
      if (this.isExtensionPathMetadata(metadata)) {
        return metadata;
      }
    }

    return undefined;
  }

  private isExtensionPathMetadata(
    value: unknown,
  ): value is ExtensionPathMetadata {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as {
      source?: unknown;
      scope?: unknown;
      origin?: unknown;
    };

    return (
      typeof candidate.source === "string" &&
      (candidate.scope === "user" ||
        candidate.scope === "project" ||
        candidate.scope === "temporary") &&
      (candidate.origin === "package" || candidate.origin === "top-level")
    );
  }

  private mapScopeToGroup(
    scope: ResourceScope | undefined,
  ): "global" | "local" {
    if (scope === "user") {
      return "global";
    }

    return "local";
  }

  private getExtensionDisplayName(
    path: string,
    metadata: ExtensionPathMetadata | undefined,
  ): string {
    const fromSource = metadata
      ? this.getNameFromSource(metadata.source)
      : undefined;

    if (fromSource) {
      return fromSource;
    }

    return this.getExtensionNameFromPath(path);
  }

  private getNameFromSource(source: string): string | undefined {
    const trimmed = source.trim();
    if (
      !trimmed ||
      trimmed === "auto" ||
      trimmed === "local" ||
      trimmed === "cli"
    ) {
      return undefined;
    }

    if (trimmed.startsWith("npm:")) {
      const packageName = this.parseNpmPackageName(trimmed.slice(4));
      return packageName ? this.getShortPackageName(packageName) : undefined;
    }

    if (
      !trimmed.includes("://") &&
      !trimmed.startsWith("git:") &&
      !trimmed.startsWith("git@") &&
      !trimmed.startsWith("./") &&
      !trimmed.startsWith("../") &&
      !trimmed.startsWith("/") &&
      !trimmed.startsWith("~")
    ) {
      const packageName = this.parseNpmPackageName(trimmed);
      return packageName ? this.getShortPackageName(packageName) : undefined;
    }

    const repositoryName = this.getRepositoryName(trimmed);
    if (repositoryName) {
      return repositoryName;
    }

    return undefined;
  }

  private parseNpmPackageName(spec: string): string | undefined {
    const trimmed = spec.trim();
    if (!trimmed) {
      return undefined;
    }

    if (trimmed.startsWith("@")) {
      const slashIndex = trimmed.indexOf("/");
      if (slashIndex === -1) {
        return undefined;
      }

      const versionIndex = trimmed.indexOf("@", slashIndex + 1);
      return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
    }

    const versionIndex = trimmed.indexOf("@");
    return versionIndex === -1 ? trimmed : trimmed.slice(0, versionIndex);
  }

  private getShortPackageName(packageName: string): string {
    const slashIndex = packageName.lastIndexOf("/");
    if (slashIndex === -1) {
      return packageName;
    }

    return packageName.slice(slashIndex + 1);
  }

  private getRepositoryName(source: string): string | undefined {
    const withoutPrefix = source.startsWith("git:") ? source.slice(4) : source;

    if (withoutPrefix.includes("://")) {
      try {
        const url = new URL(withoutPrefix);
        const base = basename(url.pathname);
        return this.stripGitSuffixAndRef(base);
      } catch {
        return undefined;
      }
    }

    if (withoutPrefix.startsWith("git@")) {
      const splitIndex = Math.max(
        withoutPrefix.lastIndexOf("/"),
        withoutPrefix.lastIndexOf(":"),
      );
      const tail =
        splitIndex === -1 ? withoutPrefix : withoutPrefix.slice(splitIndex + 1);
      return this.stripGitSuffixAndRef(tail);
    }

    return undefined;
  }

  private stripGitSuffixAndRef(value: string): string | undefined {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const noGitSuffix = trimmed.endsWith(".git")
      ? trimmed.slice(0, -4)
      : trimmed;

    const refIndex = noGitSuffix.indexOf("@");
    const withoutRef =
      refIndex > 0 ? noGitSuffix.slice(0, refIndex) : noGitSuffix;

    return withoutRef || undefined;
  }

  private getExtensionNameFromPath(path: string): string {
    const trimmed = path.trim();
    if (!trimmed) {
      return "unnamed-extension";
    }

    if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
      return trimmed.slice(1, -1);
    }

    const fileName = basename(trimmed);
    const extension = extname(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;

    if (stem !== "index") {
      return stem || fileName;
    }

    const parent = basename(dirname(trimmed));
    if (!parent || parent === "." || parent === "..") {
      return stem;
    }

    if (["src", "dist", "build", "lib", "out"].includes(parent)) {
      const grandparent = basename(dirname(dirname(trimmed)));
      if (grandparent && grandparent !== "." && grandparent !== "..") {
        return grandparent;
      }
    }

    return parent;
  }

  private compactSessionEventForWire(event: unknown): unknown {
    if (!event || typeof event !== "object") {
      return event;
    }

    const source = event as {
      type?: unknown;
      reason?: unknown;
      aborted?: unknown;
      willRetry?: unknown;
      errorMessage?: unknown;
      result?: { summary?: unknown; tokensBefore?: unknown } | unknown;
    };

    if (source.type === "agent_end") {
      return { type: "agent_end" };
    }

    if (source.type === "auto_compaction_start") {
      return {
        type: "auto_compaction_start",
        reason: source.reason === "overflow" ? "overflow" : "threshold",
      };
    }

    if (source.type === "auto_compaction_end") {
      const resultSource =
        source.result && typeof source.result === "object"
          ? (source.result as { summary?: unknown; tokensBefore?: unknown })
          : null;

      return {
        type: "auto_compaction_end",
        aborted: source.aborted === true,
        willRetry: source.willRetry === true,
        errorMessage:
          typeof source.errorMessage === "string"
            ? source.errorMessage
            : undefined,
        result:
          resultSource &&
          (typeof resultSource.summary === "string" ||
            typeof resultSource.tokensBefore === "number")
            ? {
                summary:
                  typeof resultSource.summary === "string"
                    ? resultSource.summary
                    : undefined,
                tokensBefore:
                  typeof resultSource.tokensBefore === "number"
                    ? resultSource.tokensBefore
                    : undefined,
              }
            : null,
      };
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
