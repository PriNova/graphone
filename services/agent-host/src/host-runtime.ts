import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import type { AgentMessage, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  stripFrontmatter,
  type AgentSession,
  type SessionEntry,
} from "@mariozechner/pi-coding-agent";

import {
  createSessionScopedBashOperations,
  wrapBashOperationsWithCwd,
  type BashCommandResult,
} from "./bash-executor.js";
import {
  ExtensionNameResolver,
  type RegisteredExtensionSummary,
} from "./extension-name-resolver.js";
import {
  ModelCatalogSync,
  type ModelCatalogSyncResult,
} from "./model-catalog-sync.js";
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

// ── Types ───────────────────────────────────────────────────────────────────

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

interface AvailableSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  location?: "user" | "project" | "path";
  path?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function expandSkillCommandForRpc(
  session: AgentSession,
  message: string,
): string {
  if (!message.startsWith("/skill:")) {
    return message;
  }

  const spaceIndex = message.indexOf(" ");
  const skillName =
    spaceIndex === -1 ? message.slice(7) : message.slice(7, spaceIndex);
  const args = spaceIndex === -1 ? "" : message.slice(spaceIndex + 1).trim();

  const skill = session.resourceLoader
    .getSkills()
    .skills.find((candidate) => candidate.name === skillName);

  if (!skill) {
    return message;
  }

  try {
    const body = stripFrontmatter(readFileSync(skill.filePath, "utf-8")).trim();
    const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    return args ? `${skillBlock}\n\nUser: ${args}` : skillBlock;
  } catch {
    return message;
  }
}

function compactSessionEventForWire(event: unknown): unknown {
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

function parseEntryTimestamp(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function convertEntryToDisplayMessage(
  entry: SessionEntry,
): AgentMessage | Record<string, unknown> | null {
  switch (entry.type) {
    case "message":
      return entry.message;

    case "custom_message":
      return {
        role: "custom",
        customType: entry.customType,
        content: entry.content,
        details: entry.details,
        display: entry.display,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };

    case "branch_summary":
      return {
        role: "branchSummary",
        summary: entry.summary,
        fromId: entry.fromId,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };

    case "compaction":
      return {
        role: "compactionSummary",
        summary: entry.summary,
        tokensBefore: entry.tokensBefore,
        timestamp: parseEntryTimestamp(entry.timestamp),
      };

    default:
      return null;
  }
}

function buildFullTranscriptMessages(
  session: AgentSession,
): Array<AgentMessage | Record<string, unknown>> {
  const entries = session.sessionManager.getBranch();
  const messages: Array<AgentMessage | Record<string, unknown>> = [];

  for (const entry of entries) {
    const converted = convertEntryToDisplayMessage(entry);
    if (!converted) {
      continue;
    }
    messages.push(converted);
  }

  return messages;
}

// ── HostRuntime ─────────────────────────────────────────────────────────────

export class HostRuntime {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = new ModelRegistry(this.authStorage);
  private readonly oauthLoginManager = new OAuthLoginManager(
    this.authStorage,
    this.modelRegistry,
  );
  private readonly modelCatalogSync = new ModelCatalogSync(
    this.authStorage,
    this.modelRegistry,
  );
  private readonly extensionNameResolver = new ExtensionNameResolver();

  constructor(
    private readonly emitSessionEvent: (event: SessionEventEnvelope) => void,
  ) {}

  async initialize(): Promise<void> {
    await this.syncModelCatalog();
    this.modelRegistry.refresh();
  }

  // ── Session lifecycle ─────────────────────────────────────────────────────

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
      return { sessionId: existing.sessionId, cwd: existing.cwd };
    }

    const fallbackCwd = validateCwd(args.cwd);
    const sessionManager = args.sessionFile
      ? SessionManager.open(validateSessionFile(args.sessionFile))
      : SessionManager.create(fallbackCwd);

    const resolvedCwd = validateCwd(sessionManager.getCwd());
    this.modelRegistry.refresh();

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
        event: compactSessionEventForWire(event),
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

  // ── Session interaction ───────────────────────────────────────────────────

  async prompt(
    sessionId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<void> {
    const session = this.requireSession(sessionId, "prompt");
    const expandedMessage = expandSkillCommandForRpc(session, message);

    session
      .prompt(expandedMessage, {
        images,
        streamingBehavior,
        source: "rpc",
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[pi-host-sidecar] prompt failed for session ${sessionId}: ${message}`,
        );
      });
  }

  async steer(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "steer");
    await session.steer(expandSkillCommandForRpc(session, message), images);
  }

  async followUp(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "follow_up");
    await session.followUp(expandSkillCommandForRpc(session, message), images);
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId, "abort");
    await session.abort();
  }

  // ── Bash execution ────────────────────────────────────────────────────────

  async bash(
    sessionId: string,
    command: string,
    excludeFromContext = false,
  ): Promise<BashCommandResult> {
    const hosted = this.requireHostedSession(sessionId, "bash");
    const session = hosted.session;

    if (session.isBashRunning) {
      throw new Error("A bash command is already running for this session.");
    }

    const emitBashEvent = (event: Record<string, unknown>): void => {
      this.emitSessionEvent({ type: "session_event", sessionId, event });
    };

    emitBashEvent({
      type: "bash_execution_start",
      command,
      excludeFromContext,
      timestamp: Date.now(),
    });

    // Check if extension runner handles this bash command
    const extensionRunner = session.extensionRunner;
    const eventResult = extensionRunner?.hasHandlers("user_bash")
      ? await extensionRunner.emitUserBash({
          type: "user_bash",
          command,
          excludeFromContext,
          cwd: hosted.cwd,
        })
      : undefined;

    if (eventResult?.result) {
      session.recordBashResult(command, eventResult.result, {
        excludeFromContext,
      });

      emitBashEvent({
        type: "bash_execution_end",
        command,
        output: eventResult.result.output,
        exitCode: eventResult.result.exitCode,
        cancelled: eventResult.result.cancelled,
        truncated: eventResult.result.truncated,
        fullOutputPath: eventResult.result.fullOutputPath,
        excludeFromContext,
        timestamp: Date.now(),
      });

      return {
        output: eventResult.result.output,
        exitCode: eventResult.result.exitCode,
        cancelled: eventResult.result.cancelled,
        truncated: eventResult.result.truncated,
        fullOutputPath: eventResult.result.fullOutputPath,
      };
    }

    const operations = eventResult?.operations
      ? wrapBashOperationsWithCwd(eventResult.operations, hosted.cwd)
      : createSessionScopedBashOperations(hosted.cwd);

    try {
      const result = await session.executeBash(
        command,
        (chunk) => {
          if (chunk.length === 0) return;
          emitBashEvent({ type: "bash_execution_update", chunk });
        },
        { excludeFromContext, operations },
      );

      emitBashEvent({
        type: "bash_execution_end",
        command,
        output: result.output,
        exitCode: result.exitCode,
        cancelled: result.cancelled,
        truncated: result.truncated,
        fullOutputPath: result.fullOutputPath,
        excludeFromContext,
        timestamp: Date.now(),
      });

      return {
        output: result.output,
        exitCode: result.exitCode,
        cancelled: result.cancelled,
        truncated: result.truncated,
        fullOutputPath: result.fullOutputPath,
      };
    } catch (error) {
      emitBashEvent({
        type: "bash_execution_end",
        command,
        output: "",
        cancelled: false,
        truncated: false,
        excludeFromContext,
        timestamp: Date.now(),
      });
      throw error;
    }
  }

  async abortBash(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId, "abort_bash");
    session.abortBash();
  }

  // ── State queries ─────────────────────────────────────────────────────────

  getMessages(sessionId: string): {
    messages: Array<AgentMessage | Record<string, unknown>>;
  } {
    const session = this.requireSession(sessionId, "get_messages");
    return { messages: buildFullTranscriptMessages(session) };
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

  // ── Model management ──────────────────────────────────────────────────────

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<unknown> {
    const session = this.requireSession(sessionId, "set_model");
    this.modelRegistry.refresh();

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
    this.modelRegistry.refresh();

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

  // ── Extensions ────────────────────────────────────────────────────────────

  getRegisteredExtensions(sessionId: string): {
    global: RegisteredExtensionSummary[];
    local: RegisteredExtensionSummary[];
    errors: Array<{ path: string; error: string }>;
  } {
    const session = this.requireSession(sessionId, "get_registered_extensions");
    const extensionsResult = session.resourceLoader.getExtensions();
    const pathMetadata = session.resourceLoader.getPathMetadata();

    const summaries = extensionsResult.extensions.map((extension) => {
      const metadata = this.extensionNameResolver.getMetadata(
        extension,
        pathMetadata,
      );
      const scope = this.extensionNameResolver.mapScopeToGroup(metadata?.scope);

      return {
        name: this.extensionNameResolver.getDisplayName(
          extension.path,
          metadata,
        ),
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

  getCommands(sessionId: string): { commands: AvailableSlashCommand[] } {
    const session = this.requireSession(sessionId, "get_commands");
    const commands: AvailableSlashCommand[] = [];

    for (const {
      command,
      extensionPath,
    } of session.extensionRunner?.getRegisteredCommandsWithPaths() ?? []) {
      commands.push({
        name: command.name,
        description: command.description,
        source: "extension",
        path: extensionPath,
      });
    }

    for (const template of session.promptTemplates) {
      commands.push({
        name: template.name,
        description: template.description,
        source: "prompt",
        location: template.source as AvailableSlashCommand["location"],
        path: template.filePath,
      });
    }

    for (const skill of session.resourceLoader.getSkills().skills) {
      commands.push({
        name: `skill:${skill.name}`,
        description: skill.description,
        source: "skill",
        location: skill.source as AvailableSlashCommand["location"],
        path: skill.filePath,
      });
    }

    return { commands };
  }

  // ── OAuth ─────────────────────────────────────────────────────────────────

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

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }

    this.oauthLoginManager.shutdown();
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async syncModelCatalog(): Promise<void> {
    try {
      const result: ModelCatalogSyncResult = await this.modelCatalogSync.sync();

      if (result.synced.length > 0) {
        const synced = result.synced
          .map(
            (entry) =>
              `${entry.provider} +${entry.added}/-${entry.removed} (${entry.before}->${entry.after})`,
          )
          .join(", ");
        console.error(
          `[pi-host-sidecar] startup model catalog sync: ${synced}`,
        );
      }

      if (result.errors.length > 0) {
        const errors = result.errors
          .map((entry) => `${entry.provider}: ${entry.error}`)
          .join(" | ");
        console.error(
          `[pi-host-sidecar] startup model catalog sync errors: ${errors}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[pi-host-sidecar] startup model catalog sync failed: ${message}`,
      );
    }
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

  private requireHostedSession(
    sessionId: string | undefined,
    command: string,
  ): HostedSession {
    const normalized = sessionId?.trim();
    if (!normalized) {
      throw new Error(`sessionId is required for ${command}`);
    }

    const hosted = this.sessions.get(normalized);
    if (!hosted) {
      throw new Error(`Unknown sessionId: ${normalized}`);
    }

    return hosted;
  }

  private requireSession(
    sessionId: string | undefined,
    command: string,
  ): AgentSession {
    return this.requireHostedSession(sessionId, command).session;
  }
}
