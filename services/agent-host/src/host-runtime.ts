import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";

import {
  AuthStorage,
  createAgentSession,
  getShellConfig,
  ModelRegistry,
  SessionManager,
  stripFrontmatter,
  type AgentSession,
  type BashOperations,
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

interface AvailableSlashCommand {
  name: string;
  description?: string;
  source: "extension" | "prompt" | "skill";
  location?: "user" | "project" | "path";
  path?: string;
}

interface ModelsJsonModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

interface ModelsJsonProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  models?: ModelsJsonModelEntry[];
  [key: string]: unknown;
}

interface ModelsJsonConfig {
  providers?: Record<string, ModelsJsonProviderEntry>;
}

interface ModelCatalogSyncSummary {
  provider: string;
  before: number;
  after: number;
  added: number;
  removed: number;
}

interface ModelCatalogSyncResult {
  synced: ModelCatalogSyncSummary[];
  skipped: Array<{ provider: string; reason: string }>;
  errors: Array<{ provider: string; error: string }>;
}

interface BashCommandResult {
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
}

interface DiscoveredModelCatalogEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  contextWindow?: number;
  maxTokens?: number;
}

const DISCOVERABLE_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

function createSessionScopedBashOperations(cwd: string): BashOperations {
  return {
    exec: async (command, _cwd, options) => {
      const { shell, args } = getShellConfig();

      return await new Promise<{ exitCode: number | null }>(
        (resolve, reject) => {
          const child = spawn(shell, [...args, command], {
            cwd,
            env: {
              ...process.env,
              ...(options.env ?? {}),
            },
            stdio: ["ignore", "pipe", "pipe"],
            detached: process.platform !== "win32",
          });

          let settled = false;
          let abortTimer: ReturnType<typeof setTimeout> | null = null;

          const finalize = (callback: () => void): void => {
            if (settled) {
              return;
            }

            settled = true;

            if (abortTimer) {
              clearTimeout(abortTimer);
              abortTimer = null;
            }

            if (options.signal) {
              options.signal.removeEventListener("abort", abortHandler);
            }

            callback();
          };

          const abortHandler = (): void => {
            if (child.exitCode !== null || child.killed) {
              return;
            }

            if (process.platform === "win32") {
              child.kill();
              return;
            }

            const pid = child.pid;
            if (!pid) {
              child.kill();
              return;
            }

            try {
              process.kill(-pid, "SIGTERM");
            } catch {
              child.kill("SIGTERM");
            }

            abortTimer = setTimeout(() => {
              if (child.exitCode !== null || child.killed) {
                return;
              }

              try {
                process.kill(-pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            }, 250);
          };

          if (options.signal) {
            if (options.signal.aborted) {
              abortHandler();
            } else {
              options.signal.addEventListener("abort", abortHandler, {
                once: true,
              });
            }
          }

          child.stdout?.on("data", (data: Buffer) => {
            options.onData(data);
          });

          child.stderr?.on("data", (data: Buffer) => {
            options.onData(data);
          });

          child.once("error", (error) => {
            finalize(() => reject(error));
          });

          child.once("close", (code) => {
            finalize(() => resolve({ exitCode: code }));
          });
        },
      );
    },
  };
}

function wrapBashOperationsWithCwd(
  operations: BashOperations,
  cwd: string,
): BashOperations {
  return {
    exec: (command, _cwd, options) => operations.exec(command, cwd, options),
  };
}

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

  async initialize(): Promise<void> {
    try {
      const catalogSync = await this.syncModelsJsonFromProviderCatalogs();

      if (catalogSync.synced.length > 0) {
        const synced = catalogSync.synced
          .map(
            (entry) =>
              `${entry.provider} +${entry.added}/-${entry.removed} (${entry.before}->${entry.after})`,
          )
          .join(", ");
        console.error(
          `[pi-host-sidecar] startup model catalog sync: ${synced}`,
        );
      }

      if (catalogSync.errors.length > 0) {
        const errors = catalogSync.errors
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

    this.modelRegistry.refresh();
  }

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

    // Pick up the latest local models.json/provider overrides before session bootstrap.
    // Provider catalog syncing is handled once during host startup.
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
    const expandedMessage = expandSkillCommandForRpc(session, message);

    // Fire-and-forget to keep prompt acknowledgements immediate,
    // matching RPC mode behavior where streaming continues via events.
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
      this.emitSessionEvent({
        type: "session_event",
        sessionId,
        event,
      });
    };

    emitBashEvent({
      type: "bash_execution_start",
      command,
      excludeFromContext,
      timestamp: Date.now(),
    });

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
          if (chunk.length === 0) {
            return;
          }

          emitBashEvent({
            type: "bash_execution_update",
            chunk,
          });
        },
        {
          excludeFromContext,
          operations,
        },
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

    // Keep provider/model list fresh (built-ins from current package + models.json).
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
    // Refresh before listing so model picker reflects local models.json edits,
    // but do not re-sync remote provider catalogs here.
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

  private async syncModelsJsonFromProviderCatalogs(): Promise<ModelCatalogSyncResult> {
    const candidates = this.getModelCatalogDiscoveryCandidates();

    if (candidates.length === 0) {
      return { synced: [], skipped: [], errors: [] };
    }

    const modelsJsonPath = this.getModelsJsonPath();
    let config: ModelsJsonConfig;

    try {
      config = await this.readModelsJsonConfig(modelsJsonPath);
    } catch (error) {
      return {
        synced: [],
        skipped: [],
        errors: [
          {
            provider: "models.json",
            error:
              error instanceof Error
                ? error.message
                : "Failed to read models.json",
          },
        ],
      };
    }

    if (!config.providers || typeof config.providers !== "object") {
      config.providers = {};
    }

    const result: ModelCatalogSyncResult = {
      synced: [],
      skipped: [],
      errors: [],
    };

    let fileChanged = false;

    for (const candidate of candidates) {
      try {
        const discoveredModels = await this.discoverProviderModels(
          candidate.provider,
          candidate.api,
          candidate.baseUrl,
        );

        if (discoveredModels.length === 0) {
          result.skipped.push({
            provider: candidate.provider,
            reason: "provider catalog returned zero models",
          });
          continue;
        }

        const providerConfig =
          config.providers[candidate.provider] &&
          typeof config.providers[candidate.provider] === "object"
            ? (config.providers[candidate.provider] as ModelsJsonProviderEntry)
            : {};

        const existingModels = Array.isArray(providerConfig.models)
          ? providerConfig.models.filter(
              (entry): entry is ModelsJsonModelEntry =>
                Boolean(
                  entry &&
                  typeof entry === "object" &&
                  typeof (entry as ModelsJsonModelEntry).id === "string",
                ),
            )
          : [];

        const existingIds = existingModels.map((entry) => entry.id);
        const discoveredIds = discoveredModels.map((entry) => entry.id);
        const existingIdSet = new Set(existingIds);
        const discoveredIdSet = new Set(discoveredIds);

        const added = discoveredIds.filter(
          (id) => !existingIdSet.has(id),
        ).length;
        const removed = existingIds.filter(
          (id) => !discoveredIdSet.has(id),
        ).length;

        const existingById = new Map(
          existingModels.map((entry) => [entry.id, entry]),
        );

        const modelApi =
          typeof providerConfig.api === "string" && providerConfig.api.trim()
            ? undefined
            : candidate.api;

        const nextModels = discoveredModels.map((discovered) => {
          const existing = existingById.get(discovered.id);
          return this.mergeDiscoveredModelEntry(
            candidate.provider,
            existing,
            discovered,
            modelApi,
          );
        });

        let providerChanged = false;

        if (
          typeof providerConfig.baseUrl !== "string" ||
          providerConfig.baseUrl.trim().length === 0
        ) {
          providerConfig.baseUrl = candidate.baseUrl;
          providerChanged = true;
        }

        if (
          typeof providerConfig.api !== "string" ||
          providerConfig.api.trim().length === 0
        ) {
          providerConfig.api = candidate.api;
          providerChanged = true;
        }

        if (
          typeof providerConfig.apiKey !== "string" ||
          providerConfig.apiKey.trim().length === 0
        ) {
          providerConfig.apiKey = this.getDefaultProviderApiKeyEnv(
            candidate.provider,
          );
          providerChanged = true;
        }

        const modelsChanged =
          !Array.isArray(providerConfig.models) ||
          JSON.stringify(providerConfig.models) !== JSON.stringify(nextModels);

        if (modelsChanged || added > 0 || removed > 0) {
          providerConfig.models = nextModels;
          providerChanged = true;
        }

        if (providerChanged) {
          config.providers[candidate.provider] = providerConfig;
          fileChanged = true;
        }

        if (added > 0 || removed > 0) {
          result.synced.push({
            provider: candidate.provider,
            before: existingModels.length,
            after: nextModels.length,
            added,
            removed,
          });
        }
      } catch (error) {
        result.errors.push({
          provider: candidate.provider,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (fileChanged) {
      await mkdir(dirname(modelsJsonPath), { recursive: true });
      await writeFile(
        modelsJsonPath,
        `${JSON.stringify(config, null, 2)}\n`,
        "utf-8",
      );
    }

    return result;
  }

  private getModelCatalogDiscoveryCandidates(): Array<{
    provider: string;
    api: string;
    baseUrl: string;
  }> {
    const byProvider = new Map<
      string,
      {
        provider: string;
        api: string;
        baseUrl: string;
      }
    >();

    for (const model of this.modelRegistry.getAvailable()) {
      if (byProvider.has(model.provider)) {
        continue;
      }

      const api = typeof model.api === "string" ? model.api.trim() : "";
      const baseUrl =
        typeof model.baseUrl === "string" ? model.baseUrl.trim() : "";

      if (!api || !baseUrl || !DISCOVERABLE_APIS.has(api)) {
        continue;
      }

      byProvider.set(model.provider, {
        provider: model.provider,
        api,
        baseUrl,
      });
    }

    return Array.from(byProvider.values()).sort((a, b) =>
      a.provider.localeCompare(b.provider),
    );
  }

  private async discoverProviderModels(
    provider: string,
    api: string,
    baseUrl: string,
  ): Promise<DiscoveredModelCatalogEntry[]> {
    if (provider === "openai-codex" || api === "openai-codex-responses") {
      return this.discoverOpenAICodexModels(provider, baseUrl);
    }

    return this.discoverOpenAICompatibleModels(provider, baseUrl);
  }

  private async discoverOpenAICompatibleModels(
    provider: string,
    baseUrl: string,
  ): Promise<DiscoveredModelCatalogEntry[]> {
    const apiKey = await this.authStorage.getApiKey(provider);

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (apiKey && apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const candidates = this.buildModelCatalogUrlCandidates(baseUrl);

    let lastError = "unknown error";

    for (const url of candidates) {
      try {
        const response = await fetch(url, {
          method: "GET",
          headers,
          signal: AbortSignal.timeout(6000),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`);
        }

        const payload = (await response.json()) as unknown;
        const models = this.parseOpenAICompatibleModelCatalog(payload);
        if (models.length === 0) {
          throw new Error("catalog response did not include model IDs");
        }

        return models;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(lastError);
  }

  private async discoverOpenAICodexModels(
    provider: string,
    baseUrl: string,
  ): Promise<DiscoveredModelCatalogEntry[]> {
    const apiKey = await this.authStorage.getApiKey(provider);
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error("No auth available for openai-codex");
    }

    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    if (!normalizedBaseUrl) {
      throw new Error("Missing baseUrl for openai-codex");
    }

    const codexBaseUrl = normalizedBaseUrl.endsWith("/codex")
      ? normalizedBaseUrl
      : `${normalizedBaseUrl}/codex`;
    const url = `${codexBaseUrl}/models?client_version=99.99.99`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": this.getOpenAICodexUserAgent(),
      },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      console.error(
        `[pi-host-sidecar] openai-codex model catalog request failed: url=${url} status=${response.status} ${response.statusText}`,
      );
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as unknown;
    const models = this.parseOpenAICodexModelCatalog(payload);
    if (models.length === 0) {
      console.error(
        `[pi-host-sidecar] openai-codex model catalog returned no models: url=${url}`,
      );
      throw new Error("catalog response did not include codex model IDs");
    }

    console.error(
      `[pi-host-sidecar] openai-codex model catalog fetched: url=${url} models=${models.length}`,
    );

    return models;
  }

  private buildModelCatalogUrlCandidates(baseUrl: string): string[] {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    if (!normalized) {
      return [];
    }

    const candidates = [`${normalized}/models`];
    if (!/\/v\d+$/i.test(normalized)) {
      candidates.push(`${normalized}/v1/models`);
    }

    return Array.from(new Set(candidates));
  }

  private parseOpenAICompatibleModelCatalog(
    payload: unknown,
  ): DiscoveredModelCatalogEntry[] {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const source = payload as {
      data?: unknown;
      models?: unknown;
    };

    const entries: unknown[] = [];

    if (Array.isArray(source.data)) {
      entries.push(...source.data);
    }

    if (Array.isArray(source.models)) {
      entries.push(...source.models);
    }

    const models: DiscoveredModelCatalogEntry[] = [];

    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const model = entry as { id?: unknown; name?: unknown };
      const id =
        typeof model.id === "string" && model.id.trim().length > 0
          ? model.id.trim()
          : typeof model.name === "string" && model.name.trim().length > 0
            ? model.name.trim()
            : undefined;

      if (!id) {
        continue;
      }

      models.push({
        id,
        name:
          typeof model.name === "string" && model.name.trim().length > 0
            ? model.name.trim()
            : id,
      });
    }

    return this.dedupeDiscoveredModels(models);
  }

  private parseOpenAICodexModelCatalog(
    payload: unknown,
  ): DiscoveredModelCatalogEntry[] {
    if (!payload || typeof payload !== "object") {
      return [];
    }

    const source = payload as { models?: unknown };
    if (!Array.isArray(source.models)) {
      return [];
    }

    const models: DiscoveredModelCatalogEntry[] = [];

    for (const entry of source.models) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const model = entry as {
        slug?: unknown;
        display_name?: unknown;
        input_modalities?: unknown;
        supported_reasoning_levels?: unknown;
        context_window?: unknown;
      };

      const id =
        typeof model.slug === "string" && model.slug.trim().length > 0
          ? model.slug.trim()
          : undefined;
      if (!id) {
        continue;
      }

      const inputModalities = Array.isArray(model.input_modalities)
        ? model.input_modalities
            .map((value) => (typeof value === "string" ? value : undefined))
            .filter((value): value is string => Boolean(value))
        : [];

      const input: Array<"text" | "image"> = ["text"];
      if (inputModalities.includes("image")) {
        input.push("image");
      }

      models.push({
        id,
        name:
          typeof model.display_name === "string" &&
          model.display_name.trim().length > 0
            ? model.display_name.trim()
            : id,
        api: "openai-codex-responses",
        reasoning:
          Array.isArray(model.supported_reasoning_levels) &&
          model.supported_reasoning_levels.length > 0,
        input,
        contextWindow:
          typeof model.context_window === "number" &&
          Number.isFinite(model.context_window) &&
          model.context_window > 0
            ? model.context_window
            : undefined,
        maxTokens: 128000,
      });
    }

    return this.dedupeDiscoveredModels(models);
  }

  private dedupeDiscoveredModels(
    models: DiscoveredModelCatalogEntry[],
  ): DiscoveredModelCatalogEntry[] {
    const byId = new Map<string, DiscoveredModelCatalogEntry>();
    for (const model of models) {
      if (!byId.has(model.id)) {
        byId.set(model.id, model);
      }
    }

    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }

  private mergeDiscoveredModelEntry(
    provider: string,
    existing: ModelsJsonModelEntry | undefined,
    discovered: DiscoveredModelCatalogEntry,
    defaultApi: string | undefined,
  ): ModelsJsonModelEntry {
    const next: ModelsJsonModelEntry = existing
      ? { ...existing }
      : { id: discovered.id };

    next.id = discovered.id;

    if (
      !next.name ||
      typeof next.name !== "string" ||
      next.name.trim().length === 0
    ) {
      next.name = discovered.name ?? discovered.id;
    }

    if (
      discovered.api &&
      (!next.api ||
        typeof next.api !== "string" ||
        next.api.trim().length === 0)
    ) {
      next.api = discovered.api;
    } else if (
      defaultApi &&
      (!next.api ||
        typeof next.api !== "string" ||
        next.api.trim().length === 0)
    ) {
      next.api = defaultApi;
    }

    // Inherit reasoning from discovered model if explicitly provided,
    // otherwise fall back to the built-in model definition.
    if (typeof discovered.reasoning === "boolean") {
      next.reasoning = discovered.reasoning;
    } else if (typeof next.reasoning !== "boolean") {
      const builtIn = this.modelRegistry.find(provider, discovered.id);
      if (builtIn?.reasoning) {
        next.reasoning = true;
      }
    }

    if (
      discovered.input &&
      (!Array.isArray(next.input) || next.input.length === 0)
    ) {
      next.input = discovered.input;
    }

    if (
      typeof discovered.contextWindow === "number" &&
      (!(typeof next.contextWindow === "number") || next.contextWindow <= 0)
    ) {
      next.contextWindow = discovered.contextWindow;
    }

    if (
      typeof discovered.maxTokens === "number" &&
      (!(typeof next.maxTokens === "number") || next.maxTokens <= 0)
    ) {
      next.maxTokens = discovered.maxTokens;
    }

    return next;
  }

  private getOpenAICodexUserAgent(): string {
    const platform = process.platform || "unknown";
    const arch = process.arch || "unknown";
    return `pi (${platform}; ${arch})`;
  }

  private getDefaultProviderApiKeyEnv(provider: string): string {
    if (provider === "openai-codex") {
      return "OPENAI_CODEX_API_KEY";
    }

    if (provider === "azure-openai-responses") {
      return "AZURE_OPENAI_API_KEY";
    }

    return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  }

  private async readModelsJsonConfig(path: string): Promise<ModelsJsonConfig> {
    try {
      const content = await readFile(path, "utf-8");
      const parsed = JSON.parse(content) as unknown;

      if (!parsed || typeof parsed !== "object") {
        return { providers: {} };
      }

      const config = parsed as ModelsJsonConfig;
      if (!config.providers || typeof config.providers !== "object") {
        return { ...config, providers: {} };
      }

      return config;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: unknown }).code === "ENOENT"
      ) {
        return { providers: {} };
      }

      throw error;
    }
  }

  private getModelsJsonPath(): string {
    const configuredAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
    const agentDir = configuredAgentDir
      ? this.expandTilde(configuredAgentDir)
      : join(homedir(), ".pi", "agent");

    return join(agentDir, "models.json");
  }

  private expandTilde(path: string): string {
    if (!path.startsWith("~")) {
      return path;
    }

    if (path === "~") {
      return homedir();
    }

    if (path.startsWith("~/")) {
      return join(homedir(), path.slice(2));
    }

    return path;
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
