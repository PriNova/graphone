import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

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

interface ModelsJsonModelEntry {
  id: string;
  name?: string;
  api?: string;
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

const DISCOVERABLE_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
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

    // Strict freshness: sync provider catalogs into models.json before bootstrap.
    try {
      await this.syncModelsJsonFromProviderCatalogs();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[pi-host-sidecar] model catalog sync failed before create_session: ${message}`,
      );
    }

    // Pick up latest models.json/provider overrides before session bootstrap.
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
    const countByProvider = (
      models: Array<{ provider: string }>,
    ): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const model of models) {
        counts.set(model.provider, (counts.get(model.provider) ?? 0) + 1);
      }
      return counts;
    };

    const formatDelta = (value: number): string =>
      value >= 0 ? `+${value}` : `${value}`;

    const before = this.modelRegistry.getAvailable();
    const beforeCounts = countByProvider(before);

    const catalogSync = await this.syncModelsJsonFromProviderCatalogs();

    // Refresh before listing so model picker reflects latest models.json edits.
    this.modelRegistry.refresh();

    const models = await this.modelRegistry.getAvailable();
    const afterCounts = countByProvider(models);

    if (catalogSync.synced.length > 0) {
      const synced = catalogSync.synced
        .map(
          (entry) =>
            `${entry.provider} +${entry.added}/-${entry.removed} (${entry.before}->${entry.after})`,
        )
        .join(", ");
      console.error(`[pi-host-sidecar] model catalog sync: ${synced}`);
    }

    if (catalogSync.errors.length > 0) {
      const errors = catalogSync.errors
        .map((entry) => `${entry.provider}: ${entry.error}`)
        .join(" | ");
      console.error(`[pi-host-sidecar] model catalog sync errors: ${errors}`);
    }

    const providerSummaries = Array.from(afterCounts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([provider, count]) => `${provider}=${count}`)
      .join(", ");

    const changedProviders = new Set<string>([
      ...beforeCounts.keys(),
      ...afterCounts.keys(),
    ]);

    const changedSummaries = Array.from(changedProviders)
      .map((provider) => {
        const beforeCount = beforeCounts.get(provider) ?? 0;
        const afterCount = afterCounts.get(provider) ?? 0;
        const delta = afterCount - beforeCount;
        return { provider, beforeCount, afterCount, delta };
      })
      .filter((entry) => entry.delta !== 0)
      .sort((a, b) => a.provider.localeCompare(b.provider))
      .map(
        (entry) =>
          `${entry.provider} ${formatDelta(entry.delta)} (${entry.beforeCount}->${entry.afterCount})`,
      )
      .join(", ");

    const totalDelta = models.length - before.length;
    console.error(
      `[pi-host-sidecar] models refreshed: total=${models.length} (delta=${formatDelta(totalDelta)}), providers=[${providerSummaries}], changed=${changedSummaries || "none"}`,
    );

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
        const discoveredIds = await this.discoverProviderModelIds(
          candidate.provider,
          candidate.baseUrl,
        );

        if (discoveredIds.length === 0) {
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

        const nextModels = discoveredIds.map((id) => {
          const existing = existingById.get(id);
          if (existing) {
            return existing;
          }

          return {
            id,
            name: id,
            ...(modelApi ? { api: modelApi } : {}),
          } satisfies ModelsJsonModelEntry;
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

        if (
          !Array.isArray(providerConfig.models) ||
          added > 0 ||
          removed > 0 ||
          providerConfig.models.length !== nextModels.length
        ) {
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

  private async discoverProviderModelIds(
    provider: string,
    baseUrl: string,
  ): Promise<string[]> {
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
        const ids = this.parseModelCatalogModelIds(payload);
        if (ids.length === 0) {
          throw new Error("catalog response did not include model IDs");
        }

        return ids;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new Error(lastError);
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

  private parseModelCatalogModelIds(payload: unknown): string[] {
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

    const ids = entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return undefined;
        }

        const model = entry as { id?: unknown; name?: unknown };
        if (typeof model.id === "string" && model.id.trim().length > 0) {
          return model.id.trim();
        }

        if (typeof model.name === "string" && model.name.trim().length > 0) {
          return model.name.trim();
        }

        return undefined;
      })
      .filter((id): id is string => Boolean(id));

    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  }

  private getDefaultProviderApiKeyEnv(provider: string): string {
    if (provider === "openai-codex") {
      return "OPENAI_API_KEY";
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
