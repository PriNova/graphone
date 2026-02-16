import { browser } from "$app/environment";
import { invoke } from "@tauri-apps/api/core";

import type { AvailableModel } from "$lib/stores/agent.svelte";

export type EnabledModelsSource = "project" | "global" | "none";

export interface EnabledModelsResponse {
  patterns: string[];
  defined: boolean;
  source: EnabledModelsSource | string;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

function hasGlobChars(pattern: string): boolean {
  return pattern.includes("*") || pattern.includes("?") || pattern.includes("[");
}

function splitThinkingSuffixIfValid(pattern: string): { base: string; hadSuffix: boolean } {
  const colonIdx = pattern.lastIndexOf(":");
  if (colonIdx === -1) return { base: pattern, hadSuffix: false };
  const suffix = pattern.slice(colonIdx + 1);
  if (!THINKING_LEVELS.has(suffix)) return { base: pattern, hadSuffix: false };
  return { base: pattern.slice(0, colonIdx), hadSuffix: true };
}

function escapeRegexChar(ch: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(ch) ? `\\${ch}` : ch;
}

function globToRegExp(glob: string): RegExp {
  // Minimal glob -> regex converter, supports: *, ?, and [] character classes.
  let re = "^";
  let i = 0;

  while (i < glob.length) {
    const ch = glob[i]!;

    if (ch === "*") {
      re += ".*";
      i++;
      continue;
    }

    if (ch === "?") {
      re += ".";
      i++;
      continue;
    }

    if (ch === "[") {
      // Copy character class verbatim until closing ']'.
      const end = glob.indexOf("]", i + 1);
      if (end === -1) {
        // Unclosed class: treat '[' literally.
        re += "\\[";
        i++;
        continue;
      }

      const cls = glob.slice(i, end + 1);
      // Escape backslashes inside class to avoid invalid regex sequences.
      re += cls.replace(/\\/g, "\\\\");
      i = end + 1;
      continue;
    }

    re += escapeRegexChar(ch);
    i++;
  }

  re += "$";
  return new RegExp(re, "i");
}

function matchesGlob(value: string, glob: string): boolean {
  try {
    return globToRegExp(glob).test(value);
  } catch {
    // If settings contain a weird glob, treat as non-match.
    return false;
  }
}

function isAlias(id: string): boolean {
  if (id.endsWith("-latest")) return true;
  return !/-\d{8}$/.test(id);
}

function resolveNonGlobPatternToSingleModel(pattern: string, models: AvailableModel[]): AvailableModel | undefined {
  // 1) provider/modelId exact match (case-insensitive)
  if (pattern.includes("/")) {
    const [provider, ...rest] = pattern.split("/");
    const modelId = rest.join("/");
    const exactProviderMatch = models.find(
      (m) => m.provider.toLowerCase() === provider.toLowerCase() && m.id.toLowerCase() === modelId.toLowerCase(),
    );
    if (exactProviderMatch) return exactProviderMatch;
  }

  // 2) exact model ID match (case-insensitive)
  const exactIdMatch = models.find((m) => m.id.toLowerCase() === pattern.toLowerCase());
  if (exactIdMatch) return exactIdMatch;

  // 3) partial match (id or name), then choose best:
  //    - prefer alias over dated
  //    - within group: pick the lexicographically highest ID
  const p = pattern.toLowerCase();
  const matches = models.filter((m) => {
    if (m.id.toLowerCase().includes(p)) return true;
    if (m.name && m.name.toLowerCase().includes(p)) return true;
    return false;
  });

  if (matches.length === 0) return undefined;

  const aliases = matches.filter((m) => isAlias(m.id));
  const dated = matches.filter((m) => !isAlias(m.id));

  const pickFrom = aliases.length > 0 ? aliases : dated;
  return [...pickFrom].sort((a, b) => b.id.localeCompare(a.id))[0];
}

function resolvePatternToKeys(rawPattern: string, models: AvailableModel[]): Set<string> {
  const out = new Set<string>();
  const trimmed = rawPattern.trim();
  if (!trimmed) return out;

  // Match the full pattern first (important for IDs that contain colons).
  const full = resolvePatternToKeysNoThinkingSuffix(trimmed, models);
  if (full.size > 0) {
    for (const k of full) out.add(k);
    return out;
  }

  // If there's a valid thinking suffix, retry with it stripped.
  const { base, hadSuffix } = splitThinkingSuffixIfValid(trimmed);
  if (hadSuffix && base !== trimmed) {
    const stripped = resolvePatternToKeysNoThinkingSuffix(base, models);
    for (const k of stripped) out.add(k);
  }

  return out;
}

function resolvePatternToKeysNoThinkingSuffix(pattern: string, models: AvailableModel[]): Set<string> {
  const out = new Set<string>();

  if (hasGlobChars(pattern)) {
    const base = pattern;
    for (const m of models) {
      const fullId = `${m.provider}/${m.id}`;
      if (matchesGlob(fullId, base) || matchesGlob(m.id, base)) {
        out.add(fullId);
      }
    }
    return out;
  }

  const model = resolveNonGlobPatternToSingleModel(pattern, models);
  if (model) {
    out.add(`${model.provider}/${model.id}`);
  }

  return out;
}

export class EnabledModelsStore {
  /** Effective enabledModels patterns (empty = no scoping / all enabled) */
  patterns = $state<string[]>([]);

  /** Whether enabledModels key was defined in the effective settings file */
  defined = $state(false);

  /** Where the effective setting came from */
  source = $state<EnabledModelsSource>("none");

  initialized = $state(false);

  private initPromise: Promise<void> | null = null;
  private projectDir: string | null;

  constructor(projectDir?: string | null) {
    this.projectDir = projectDir ?? null;

    if (browser) {
      this.initPromise = this.refresh().finally(() => {
        this.initialized = true;
      });
    }
  }

  setProjectDir(projectDir: string | null): void {
    this.projectDir = projectDir;
  }

  private applyResponse(response: EnabledModelsResponse): void {
    this.patterns = Array.isArray(response.patterns) ? response.patterns : [];
    this.defined = Boolean(response.defined);

    const src = response.source;
    this.source = src === "project" || src === "global" || src === "none" ? src : "none";
  }

  async refresh(): Promise<void> {
    if (!browser) return;

    try {
      const response = await invoke<EnabledModelsResponse>("get_enabled_models", {
        projectDir: this.projectDir,
      });
      this.applyResponse(response);
    } catch (error) {
      console.warn("Failed to load enabledModels from settings:", error);
      this.patterns = [];
      this.defined = false;
      this.source = "none";
    }
  }

  private async ensureInit(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  get hasScope(): boolean {
    return this.patterns.length > 0;
  }

  /**
   * Resolve enabledModels patterns into concrete model keys ("provider/modelId")
   * following pi's scoping rules.
   */
  resolveEnabledModelKeys(models: AvailableModel[]): Set<string> {
    // Matching pi behavior: empty enabledModels => no scoping => all models enabled.
    if (this.patterns.length === 0) {
      return new Set(models.map((m) => `${m.provider}/${m.id}`));
    }

    const result = new Set<string>();
    for (const p of this.patterns) {
      for (const k of resolvePatternToKeys(p, models)) {
        result.add(k);
      }
    }
    return result;
  }

  /**
   * Toggle a concrete model in enabledModels and persist to pi settings.
   */
  async toggleModel(provider: string, modelId: string, availableModels?: AvailableModel[]): Promise<void> {
    if (!browser) return;
    await this.ensureInit();

    const fullId = `${provider}/${modelId}`;

    let nextPatterns: string[];

    if (this.patterns.length === 0) {
      // "All enabled" -> start an explicit scope with this model.
      nextPatterns = [fullId];
    } else {
      // If the fullId is explicitly present, we can always remove it without needing the model list.
      if (this.patterns.includes(fullId)) {
        nextPatterns = this.patterns.filter((p) => p !== fullId);
      } else if (!availableModels || availableModels.length === 0) {
        // Without the model list we cannot know whether the model is enabled via a glob/partial pattern.
        // We only support the safe operation here: adding an explicit fullId.
        nextPatterns = [...this.patterns, fullId];
      } else {
        const enabledKeys = this.resolveEnabledModelKeys(availableModels);
        const enabledNow = enabledKeys.has(fullId);

        if (!enabledNow) {
          nextPatterns = [...this.patterns, fullId];
        } else {
          // Enabled via a pattern (glob/partial) -> expand to explicit list and remove.
          nextPatterns = [...enabledKeys].filter((k) => k !== fullId);
        }
      }
    }

    try {
      const response = await invoke<EnabledModelsResponse>("set_enabled_models", {
        patterns: nextPatterns,
        scope: "auto",
        projectDir: this.projectDir,
      });
      this.applyResponse(response);
    } catch (error) {
      console.warn("Failed to persist enabledModels to settings:", error);
      // Keep local state unchanged on failure.
    }
  }
}

export function createEnabledModelsStore(projectDir?: string | null): EnabledModelsStore {
  return new EnabledModelsStore(projectDir);
}

// Legacy singleton compatibility for old imports.
export const enabledModelsStore = createEnabledModelsStore();
