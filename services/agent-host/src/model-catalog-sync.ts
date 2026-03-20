import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { getModel, type Api, type Model as PiModel } from "@mariozechner/pi-ai";
import type { AuthStorage, ModelRegistry } from "@mariozechner/pi-coding-agent";

// ── Types ───────────────────────────────────────────────────────────────────

interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelsJsonModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: ModelCost;
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

export interface ModelCatalogSyncResult {
  synced: ModelCatalogSyncSummary[];
  skipped: Array<{ provider: string; reason: string }>;
  errors: Array<{ provider: string; error: string }>;
}

export interface DiscoveredModelCatalogEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  input?: Array<"text" | "image">;
  cost?: ModelCost;
  contextWindow?: number;
  maxTokens?: number;
}

interface CatalogDiscoveryCandidate {
  provider: string;
  api: string;
  baseUrl: string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const DISCOVERABLE_APIS = new Set([
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
]);

const DEFAULT_MODEL_COST: ModelCost = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Synchronizes models.json with remote provider catalogs (OpenAI-compatible, Codex).
 * Handles discovery, parsing, merging, and persistence of model entries.
 */
export class ModelCatalogSync {
  constructor(
    private readonly authStorage: AuthStorage,
    private readonly modelRegistry: ModelRegistry,
  ) {}

  /**
   * Run a full sync: discover providers, fetch catalogs, merge into models.json.
   */
  async sync(): Promise<ModelCatalogSyncResult> {
    const candidates = this.getDiscoveryCandidates();

    if (candidates.length === 0) {
      return { synced: [], skipped: [], errors: [] };
    }

    const modelsJsonPath = getModelsJsonPath();
    let config: ModelsJsonConfig;

    try {
      config = await readModelsJsonConfig(modelsJsonPath);
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
          ? providerConfig.models.filter(isValidModelEntry)
          : [];

        const { added, removed } = computeDiff(
          existingModels,
          discoveredModels,
        );

        const existingById = new Map(
          existingModels.map((entry) => [entry.id, entry]),
        );

        const modelApi =
          typeof providerConfig.api === "string" && providerConfig.api.trim()
            ? undefined
            : candidate.api;

        const nextModels = discoveredModels.map((discovered) => {
          const existing = existingById.get(discovered.id);
          return mergeDiscoveredModelEntry(
            candidate.provider,
            existing,
            discovered,
            modelApi,
          );
        });

        const providerChanged = this.applyProviderDefaults(
          providerConfig,
          candidate,
          nextModels,
        );

        if (providerChanged) {
          config.providers[candidate.provider] = providerConfig;
          fileChanged = true;
        }

        if (providerChanged) {
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

  // ── Private: discovery ────────────────────────────────────────────────────

  private getDiscoveryCandidates(): CatalogDiscoveryCandidate[] {
    const byProvider = new Map<string, CatalogDiscoveryCandidate>();

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
      return discoverOpenAICodexModels(this.authStorage, provider, baseUrl);
    }

    return discoverOpenAICompatibleModels(this.authStorage, provider, baseUrl);
  }

  private applyProviderDefaults(
    providerConfig: ModelsJsonProviderEntry,
    candidate: CatalogDiscoveryCandidate,
    nextModels: ModelsJsonModelEntry[],
  ): boolean {
    let changed = false;

    if (
      typeof providerConfig.baseUrl !== "string" ||
      providerConfig.baseUrl.trim().length === 0
    ) {
      providerConfig.baseUrl = candidate.baseUrl;
      changed = true;
    }

    if (
      typeof providerConfig.api !== "string" ||
      providerConfig.api.trim().length === 0
    ) {
      providerConfig.api = candidate.api;
      changed = true;
    }

    if (
      typeof providerConfig.apiKey !== "string" ||
      providerConfig.apiKey.trim().length === 0
    ) {
      providerConfig.apiKey = getDefaultProviderApiKeyEnv(candidate.provider);
      changed = true;
    }

    const modelsChanged =
      !Array.isArray(providerConfig.models) ||
      JSON.stringify(providerConfig.models) !== JSON.stringify(nextModels);

    if (modelsChanged) {
      providerConfig.models = nextModels;
      changed = true;
    }

    return changed;
  }
}

// ── Module-level helpers ────────────────────────────────────────────────────

function isValidModelEntry(entry: unknown): entry is ModelsJsonModelEntry {
  return Boolean(
    entry &&
    typeof entry === "object" &&
    typeof (entry as ModelsJsonModelEntry).id === "string",
  );
}

function computeDiff(
  existing: ModelsJsonModelEntry[],
  discovered: DiscoveredModelCatalogEntry[],
): { added: number; removed: number } {
  const existingIds = new Set(existing.map((e) => e.id));
  const discoveredIds = new Set(discovered.map((e) => e.id));

  return {
    added: discovered.filter((e) => !existingIds.has(e.id)).length,
    removed: existing.filter((e) => !discoveredIds.has(e.id)).length,
  };
}

function mergeDiscoveredModelEntry(
  provider: string,
  existing: ModelsJsonModelEntry | undefined,
  discovered: DiscoveredModelCatalogEntry,
  defaultApi: string | undefined,
): ModelsJsonModelEntry {
  const next: ModelsJsonModelEntry = existing
    ? { ...existing }
    : { id: discovered.id };
  const builtInModel = findBuiltInModel(provider, discovered.id);

  next.id = discovered.id;

  if (!next.name?.trim()) {
    next.name = discovered.name ?? builtInModel?.name ?? discovered.id;
  }

  if (discovered.api?.trim() && !next.api?.trim()) {
    next.api = discovered.api;
  } else if (defaultApi?.trim() && !next.api?.trim()) {
    next.api = defaultApi;
  }

  if (typeof next.reasoning !== "boolean") {
    next.reasoning =
      typeof discovered.reasoning === "boolean"
        ? discovered.reasoning
        : (builtInModel?.reasoning ?? false);
  }

  if (!hasValidInputArray(next.input)) {
    next.input = normalizeInputArray(discovered.input) ??
      normalizeInputArray(builtInModel?.input) ?? ["text"];
  }

  next.cost = mergeCostValues(next.cost, discovered.cost, builtInModel?.cost);

  if (!isPositiveFiniteNumber(next.contextWindow)) {
    next.contextWindow =
      parsePositiveNumber(discovered.contextWindow) ??
      parsePositiveNumber(builtInModel?.contextWindow) ??
      128000;
  }

  if (!isPositiveFiniteNumber(next.maxTokens)) {
    next.maxTokens =
      parsePositiveNumber(discovered.maxTokens) ??
      parsePositiveNumber(builtInModel?.maxTokens) ??
      16384;
  }

  return next;
}

async function discoverOpenAICompatibleModels(
  authStorage: AuthStorage,
  provider: string,
  baseUrl: string,
): Promise<DiscoveredModelCatalogEntry[]> {
  const apiKey = await authStorage.getApiKey(provider);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey?.trim()) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const candidates = buildUrlCandidates(baseUrl);
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

      const payload = await response.json();
      const models = parseOpenAICompatibleCatalog(payload);
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

async function discoverOpenAICodexModels(
  authStorage: AuthStorage,
  provider: string,
  baseUrl: string,
): Promise<DiscoveredModelCatalogEntry[]> {
  const apiKey = await authStorage.getApiKey(provider);
  if (!apiKey?.trim()) {
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
      "User-Agent": getOpenAICodexUserAgent(),
    },
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    console.error(
      `[pi-host-sidecar] openai-codex model catalog request failed: url=${url} status=${response.status} ${response.statusText}`,
    );
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const models = parseOpenAICodexCatalog(payload);
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

function buildUrlCandidates(baseUrl: string): string[] {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) return [];

  const candidates = [`${normalized}/models`];
  if (!/\/v\d+$/i.test(normalized)) {
    candidates.push(`${normalized}/v1/models`);
  }

  return [...new Set(candidates)];
}

function parseOpenAICompatibleCatalog(
  payload: unknown,
): DiscoveredModelCatalogEntry[] {
  if (!payload || typeof payload !== "object") return [];

  const source = payload as { data?: unknown; models?: unknown };
  const entries: unknown[] = [];

  if (Array.isArray(source.data)) entries.push(...source.data);
  if (Array.isArray(source.models)) entries.push(...source.models);

  const models: DiscoveredModelCatalogEntry[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;

    const model = entry as {
      id?: unknown;
      name?: unknown;
      display_name?: unknown;
      input?: unknown;
      input_modalities?: unknown;
      modalities?: unknown;
      cost?: unknown;
      pricing?: unknown;
      context_window?: unknown;
      contextWindow?: unknown;
      max_tokens?: unknown;
      maxTokens?: unknown;
      reasoning?: unknown;
    };
    const id =
      typeof model.id === "string" && model.id.trim()
        ? model.id.trim()
        : typeof model.name === "string" && model.name.trim()
          ? model.name.trim()
          : undefined;

    if (!id) continue;

    models.push({
      id,
      name:
        typeof model.name === "string" && model.name.trim()
          ? model.name.trim()
          : typeof model.display_name === "string" && model.display_name.trim()
            ? model.display_name.trim()
            : id,
      reasoning:
        typeof model.reasoning === "boolean" ? model.reasoning : undefined,
      input:
        parseCatalogInput(model.input) ??
        parseCatalogInputModalities(model.input_modalities ?? model.modalities),
      cost: parseCatalogCost(model.cost, model.pricing),
      contextWindow: parsePositiveNumber(
        model.context_window ?? model.contextWindow,
      ),
      maxTokens: parsePositiveNumber(model.max_tokens ?? model.maxTokens),
    });
  }

  return dedupeModels(models);
}

function parseOpenAICodexCatalog(
  payload: unknown,
): DiscoveredModelCatalogEntry[] {
  if (!payload || typeof payload !== "object") return [];

  const source = payload as { models?: unknown };
  if (!Array.isArray(source.models)) return [];

  const models: DiscoveredModelCatalogEntry[] = [];

  for (const entry of source.models) {
    if (!entry || typeof entry !== "object") continue;

    const model = entry as {
      slug?: unknown;
      display_name?: unknown;
      input_modalities?: unknown;
      modalities?: unknown;
      cost?: unknown;
      pricing?: unknown;
      supported_reasoning_levels?: unknown;
      context_window?: unknown;
      contextWindow?: unknown;
      max_tokens?: unknown;
      maxTokens?: unknown;
    };

    const id =
      typeof model.slug === "string" && model.slug.trim()
        ? model.slug.trim()
        : undefined;
    if (!id) continue;

    models.push({
      id,
      name:
        typeof model.display_name === "string" && model.display_name.trim()
          ? model.display_name.trim()
          : id,
      api: "openai-codex-responses",
      reasoning:
        Array.isArray(model.supported_reasoning_levels) &&
        model.supported_reasoning_levels.length > 0,
      input: parseCatalogInputModalities(
        model.input_modalities ?? model.modalities,
      ),
      cost: parseCatalogCost(model.cost, model.pricing),
      contextWindow: parsePositiveNumber(
        model.context_window ?? model.contextWindow,
      ),
      maxTokens:
        parsePositiveNumber(model.max_tokens ?? model.maxTokens) ?? 128000,
    });
  }

  return dedupeModels(models);
}

function dedupeModels(
  models: DiscoveredModelCatalogEntry[],
): DiscoveredModelCatalogEntry[] {
  const byId = new Map<string, DiscoveredModelCatalogEntry>();
  for (const model of models) {
    if (!byId.has(model.id)) byId.set(model.id, model);
  }
  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

function findBuiltInModel(
  provider: string,
  modelId: string,
): PiModel<Api> | undefined {
  return getModel(provider as never, modelId as never) as
    | PiModel<Api>
    | undefined;
}

function normalizeInputArray(
  value: unknown,
): Array<"text" | "image"> | undefined {
  if (!Array.isArray(value)) return undefined;

  const input = value.filter(
    (entry): entry is "text" | "image" => entry === "text" || entry === "image",
  );

  return input.length > 0 ? Array.from(new Set(input)) : undefined;
}

function parseCatalogInput(
  value: unknown,
): Array<"text" | "image"> | undefined {
  return normalizeInputArray(value);
}

function parseCatalogInputModalities(
  value: unknown,
): Array<"text" | "image"> | undefined {
  if (!Array.isArray(value)) return undefined;

  const modalities = value.filter(
    (entry): entry is string => typeof entry === "string",
  );
  if (modalities.length === 0) return undefined;

  const input: Array<"text" | "image"> = ["text"];
  if (modalities.some((entry) => entry === "image" || entry === "vision")) {
    input.push("image");
  }

  return input;
}

function parsePartialCostObject(
  value: unknown,
): Partial<ModelCost> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cache_read?: unknown;
    cacheWrite?: unknown;
    cache_write?: unknown;
  };

  const input = parseNonNegativeFiniteNumber(candidate.input);
  const output = parseNonNegativeFiniteNumber(candidate.output);
  const cacheRead = parseNonNegativeFiniteNumber(
    candidate.cacheRead ?? candidate.cache_read,
  );
  const cacheWrite = parseNonNegativeFiniteNumber(
    candidate.cacheWrite ?? candidate.cache_write,
  );

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }

  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(cacheRead !== undefined ? { cacheRead } : {}),
    ...(cacheWrite !== undefined ? { cacheWrite } : {}),
  };
}

function normalizeCostObject(value: unknown): ModelCost | undefined {
  const partial = parsePartialCostObject(value);
  if (!partial) {
    return undefined;
  }

  return {
    input: partial.input ?? 0,
    output: partial.output ?? 0,
    cacheRead: partial.cacheRead ?? 0,
    cacheWrite: partial.cacheWrite ?? 0,
  };
}

function parseCatalogCost(
  costValue: unknown,
  pricingValue?: unknown,
): ModelCost | undefined {
  const directCost = normalizeCostObject(costValue);
  if (directCost) {
    return directCost;
  }

  if (!pricingValue || typeof pricingValue !== "object") {
    return undefined;
  }

  const pricing = pricingValue as {
    prompt?: unknown;
    completion?: unknown;
    input?: unknown;
    output?: unknown;
    input_cache_read?: unknown;
    inputCacheRead?: unknown;
    input_cache_write?: unknown;
    inputCacheWrite?: unknown;
  };

  const input = parsePerMillionCostNumber(pricing.input ?? pricing.prompt);
  const output = parsePerMillionCostNumber(
    pricing.output ?? pricing.completion,
  );
  const cacheRead = parsePerMillionCostNumber(
    pricing.input_cache_read ?? pricing.inputCacheRead,
  );
  const cacheWrite = parsePerMillionCostNumber(
    pricing.input_cache_write ?? pricing.inputCacheWrite,
  );

  if (
    input === undefined &&
    output === undefined &&
    cacheRead === undefined &&
    cacheWrite === undefined
  ) {
    return undefined;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
  };
}

function mergeCostValues(
  currentValue: unknown,
  discoveredValue: unknown,
  builtInValue: unknown,
): ModelCost {
  const currentCost = parsePartialCostObject(currentValue);
  const discoveredCost = normalizeCostObject(discoveredValue);
  const builtInCost = normalizeCostObject(builtInValue);

  return {
    input:
      currentCost?.input ??
      discoveredCost?.input ??
      builtInCost?.input ??
      DEFAULT_MODEL_COST.input,
    output:
      currentCost?.output ??
      discoveredCost?.output ??
      builtInCost?.output ??
      DEFAULT_MODEL_COST.output,
    cacheRead:
      currentCost?.cacheRead ??
      discoveredCost?.cacheRead ??
      builtInCost?.cacheRead ??
      DEFAULT_MODEL_COST.cacheRead,
    cacheWrite:
      currentCost?.cacheWrite ??
      discoveredCost?.cacheWrite ??
      builtInCost?.cacheWrite ??
      DEFAULT_MODEL_COST.cacheWrite,
  };
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hasValidInputArray(value: unknown): value is Array<"text" | "image"> {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => entry === "text" || entry === "image")
  );
}

function parseNonNegativeFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function parsePerMillionCostNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value * 1_000_000 : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed * 1_000_000
      : undefined;
  }

  return undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  return isPositiveFiniteNumber(value) ? value : undefined;
}

function getOpenAICodexUserAgent(): string {
  const platform = process.platform || "unknown";
  const arch = process.arch || "unknown";
  return `pi (${platform}; ${arch})`;
}

function getDefaultProviderApiKeyEnv(provider: string): string {
  if (provider === "openai-codex") return "OPENAI_CODEX_API_KEY";
  if (provider === "azure-openai-responses") return "AZURE_OPENAI_API_KEY";
  return `${provider.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}

async function readModelsJsonConfig(path: string): Promise<ModelsJsonConfig> {
  try {
    const content = await readFile(path, "utf-8");
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      return { providers: {} };
    }

    const parsed = JSON.parse(trimmed) as unknown;

    if (!parsed || typeof parsed !== "object") return { providers: {} };

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

export function getModelsJsonPath(): string {
  const configuredAgentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  const agentDir = configuredAgentDir
    ? expandTilde(configuredAgentDir)
    : join(homedir(), ".pi", "agent");

  return join(agentDir, "models.json");
}

function expandTilde(path: string): string {
  if (!path.startsWith("~")) return path;
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
