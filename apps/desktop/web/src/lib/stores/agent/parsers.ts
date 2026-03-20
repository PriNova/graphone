import type {
  AvailableModel,
  AvailableSlashCommand,
  OAuthLoginStatus,
  OAuthLoginUpdate,
  OAuthProviderStatus,
  RegisteredExtensionsSnapshot,
  RegisteredExtensionSummary,
  ThinkingLevel,
  UsageContextSeverity,
  UsageIndicatorSnapshot,
  ExtensionStatusEntry,
  NavigateSessionTreeResult,
  SessionTreeEntryType,
  SessionTreeNodeRole,
  SessionTreeNodeSnapshot,
  SessionTreeSnapshot,
} from "$lib/stores/agent/types";
import { VALID_THINKING_LEVELS } from "$lib/stores/agent/types";

export function parseThinkingLevel(level: unknown): ThinkingLevel {
  if (typeof level !== "string") {
    return "off";
  }

  const normalized = level.toLowerCase() as ThinkingLevel;
  return VALID_THINKING_LEVELS.has(normalized) ? normalized : "off";
}

export function parseAvailableThinkingLevels(value: unknown): ThinkingLevel[] {
  if (!Array.isArray(value)) {
    return ["off"];
  }

  const parsed = value
    .map((level) => parseThinkingLevel(level))
    .filter(
      (level, index, all): level is ThinkingLevel =>
        VALID_THINKING_LEVELS.has(level) && all.indexOf(level) === index,
    );

  return parsed.length > 0 ? parsed : ["off"];
}

export function parseModelSupportsImageInput(input: unknown): boolean {
  if (!Array.isArray(input)) {
    return false;
  }

  return input.some((value) => value === "image");
}

export function parseOAuthProviders(value: unknown): OAuthProviderStatus[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((provider) => {
      if (!provider || typeof provider !== "object") {
        return null;
      }

      const candidate = provider as {
        id?: unknown;
        name?: unknown;
        usesCallbackServer?: unknown;
        loggedIn?: unknown;
      };

      if (typeof candidate.id !== "string" || candidate.id.length === 0) {
        return null;
      }

      return {
        id: candidate.id,
        name:
          typeof candidate.name === "string" && candidate.name.length > 0
            ? candidate.name
            : candidate.id,
        usesCallbackServer: candidate.usesCallbackServer === true,
        loggedIn: candidate.loggedIn === true,
      } satisfies OAuthProviderStatus;
    })
    .filter((provider): provider is OAuthProviderStatus => provider !== null);
}

export function parseOAuthLoginStatus(status: unknown): OAuthLoginStatus {
  if (
    status === "idle" ||
    status === "running" ||
    status === "awaiting_input" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
  ) {
    return status;
  }

  return "idle";
}

export function parseOAuthLoginUpdates(value: unknown): OAuthLoginUpdate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const updates: OAuthLoginUpdate[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const update = candidate as {
      type?: unknown;
      url?: unknown;
      instructions?: unknown;
      message?: unknown;
      placeholder?: unknown;
      allowEmpty?: unknown;
      inputType?: unknown;
      success?: unknown;
      error?: unknown;
    };

    if (update.type === "auth" && typeof update.url === "string") {
      updates.push({
        type: "auth",
        url: update.url,
        instructions:
          typeof update.instructions === "string"
            ? update.instructions
            : undefined,
      });
      continue;
    }

    if (update.type === "progress" && typeof update.message === "string") {
      updates.push({ type: "progress", message: update.message });
      continue;
    }

    if (update.type === "prompt" && typeof update.message === "string") {
      updates.push({
        type: "prompt",
        message: update.message,
        placeholder:
          typeof update.placeholder === "string"
            ? update.placeholder
            : undefined,
        allowEmpty: update.allowEmpty === true,
        inputType:
          update.inputType === "manual_code" ? "manual_code" : "prompt",
      });
      continue;
    }

    if (update.type === "complete") {
      updates.push({
        type: "complete",
        success: update.success === true,
        error: typeof update.error === "string" ? update.error : undefined,
      });
    }
  }

  return updates;
}

export function parseUsageIndicator(
  value: unknown,
): UsageIndicatorSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value as {
    tokenStatsText?: unknown;
    contextText?: unknown;
    fullText?: unknown;
    contextSeverity?: unknown;
  };

  const tokenStatsText =
    typeof source.tokenStatsText === "string" ? source.tokenStatsText : "";
  const contextText =
    typeof source.contextText === "string" ? source.contextText : "";
  const fullText = typeof source.fullText === "string" ? source.fullText : "";

  if (!tokenStatsText && !contextText && !fullText) {
    return null;
  }

  return {
    tokenStatsText,
    contextText,
    fullText:
      fullText || [tokenStatsText, contextText].filter(Boolean).join(" "),
    contextSeverity: parseUsageContextSeverity(source.contextSeverity),
  };
}

function parseUsageContextSeverity(value: unknown): UsageContextSeverity {
  if (value === "warning" || value === "error" || value === "normal") {
    return value;
  }

  return "normal";
}

export function parseExtensionStatuses(value: unknown): ExtensionStatusEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as { key?: unknown; text?: unknown };
      if (
        typeof candidate.key !== "string" ||
        candidate.key.trim().length === 0 ||
        typeof candidate.text !== "string"
      ) {
        return null;
      }

      return {
        key: candidate.key,
        text: candidate.text,
      } satisfies ExtensionStatusEntry;
    })
    .filter((entry): entry is ExtensionStatusEntry => entry !== null)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function parseAvailableModels(value: unknown): AvailableModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((model) => {
      if (!model || typeof model !== "object") {
        return null;
      }

      const candidate = model as {
        provider?: unknown;
        id?: unknown;
        name?: unknown;
        supportsImageInput?: unknown;
      };

      const provider = candidate.provider;
      const id = candidate.id;
      const name = candidate.name;

      if (typeof provider !== "string" || typeof id !== "string") {
        return null;
      }

      return {
        provider,
        id,
        name: typeof name === "string" && name.length > 0 ? name : id,
        supportsImageInput: candidate.supportsImageInput === true,
      } satisfies AvailableModel;
    })
    .filter((model): model is AvailableModel => model !== null);
}

export function parseRegisteredExtensions(
  value: unknown,
): RegisteredExtensionsSnapshot {
  if (!value || typeof value !== "object") {
    return { global: [], local: [], errors: [] };
  }

  const source = value as {
    global?: unknown;
    local?: unknown;
    errors?: unknown;
  };

  return {
    global: parseRegisteredExtensionList(source.global, "global"),
    local: parseRegisteredExtensionList(source.local, "local"),
    errors: parseExtensionErrors(source.errors),
  };
}

function parseRegisteredExtensionList(
  value: unknown,
  scope: "global" | "local",
): RegisteredExtensionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as {
        name?: unknown;
        path?: unknown;
        resolvedPath?: unknown;
        source?: unknown;
        origin?: unknown;
        toolCount?: unknown;
        commandCount?: unknown;
      };

      if (
        typeof candidate.path !== "string" ||
        typeof candidate.resolvedPath !== "string"
      ) {
        return null;
      }

      return {
        name:
          typeof candidate.name === "string" && candidate.name.length > 0
            ? candidate.name
            : candidate.path,
        path: candidate.path,
        resolvedPath: candidate.resolvedPath,
        scope,
        source:
          typeof candidate.source === "string" && candidate.source.length > 0
            ? candidate.source
            : "unknown",
        origin:
          candidate.origin === "package" || candidate.origin === "top-level"
            ? candidate.origin
            : "unknown",
        toolCount:
          typeof candidate.toolCount === "number" && candidate.toolCount >= 0
            ? candidate.toolCount
            : 0,
        commandCount:
          typeof candidate.commandCount === "number" &&
          candidate.commandCount >= 0
            ? candidate.commandCount
            : 0,
      } satisfies RegisteredExtensionSummary;
    })
    .filter(
      (extension): extension is RegisteredExtensionSummary =>
        extension !== null,
    );
}

function parseExtensionErrors(
  value: unknown,
): Array<{ path: string; error: string }> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const candidate = entry as { path?: unknown; error?: unknown };
      if (
        typeof candidate.path !== "string" ||
        typeof candidate.error !== "string"
      ) {
        return null;
      }

      return { path: candidate.path, error: candidate.error };
    })
    .filter(
      (entry): entry is { path: string; error: string } => entry !== null,
    );
}

export function parseAvailableSlashCommands(
  value: unknown,
): AvailableSlashCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const commands: AvailableSlashCommand[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as {
      name?: unknown;
      description?: unknown;
      source?: unknown;
      location?: unknown;
      path?: unknown;
    };

    if (
      typeof candidate.name !== "string" ||
      candidate.name.trim().length === 0
    ) {
      continue;
    }

    if (
      candidate.source !== "extension" &&
      candidate.source !== "prompt" &&
      candidate.source !== "skill"
    ) {
      continue;
    }

    commands.push({
      name: candidate.name,
      description:
        typeof candidate.description === "string" ? candidate.description : "",
      source: candidate.source,
      location:
        candidate.location === "user" ||
        candidate.location === "project" ||
        candidate.location === "path"
          ? candidate.location
          : undefined,
      path: typeof candidate.path === "string" ? candidate.path : undefined,
    });
  }

  return commands;
}

function parseSessionTreeRole(value: unknown): SessionTreeNodeRole | undefined {
  return value === "user" ||
    value === "assistant" ||
    value === "toolResult" ||
    value === "bashExecution" ||
    value === "custom"
    ? value
    : undefined;
}

function parseSessionTreeEntryType(
  value: unknown,
): SessionTreeEntryType | null {
  return value === "message" ||
    value === "branchSummary" ||
    value === "compaction" ||
    value === "customMessage"
    ? value
    : null;
}

function parseFlatSessionTreeNodes(value: unknown): SessionTreeNodeSnapshot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes: SessionTreeNodeSnapshot[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as {
      id?: unknown;
      parentId?: unknown;
      entryType?: unknown;
      role?: unknown;
      preview?: unknown;
      timestamp?: unknown;
    };

    const entryType = parseSessionTreeEntryType(candidate.entryType);
    if (typeof candidate.id !== "string" || entryType === null) {
      continue;
    }

    nodes.push({
      id: candidate.id,
      parentId:
        typeof candidate.parentId === "string" ? candidate.parentId : null,
      entryType,
      role: parseSessionTreeRole(candidate.role),
      preview:
        typeof candidate.preview === "string" &&
        candidate.preview.trim().length > 0
          ? candidate.preview
          : "Conversation step",
      timestamp:
        typeof candidate.timestamp === "number" &&
        Number.isFinite(candidate.timestamp)
          ? candidate.timestamp
          : 0,
      children: [],
    });
  }

  return nodes;
}

function buildSessionTree(
  flatNodes: SessionTreeNodeSnapshot[],
): SessionTreeNodeSnapshot[] {
  const nodeMap = new Map<string, SessionTreeNodeSnapshot>(
    flatNodes.map((node) => [node.id, { ...node, children: [] }]),
  );
  const roots: SessionTreeNodeSnapshot[] = [];

  for (const node of flatNodes) {
    const resolved = nodeMap.get(node.id);
    if (!resolved) {
      continue;
    }

    if (!node.parentId) {
      roots.push(resolved);
      continue;
    }

    const parent = nodeMap.get(node.parentId);
    if (!parent) {
      roots.push(resolved);
      continue;
    }

    parent.children.push(resolved);
  }

  const sortNodes = (nodes: SessionTreeNodeSnapshot[]): void => {
    nodes.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    for (const node of nodes) {
      if (node.children.length > 0) {
        sortNodes(node.children);
      }
    }
  };

  sortNodes(roots);
  return roots;
}

export function parseSessionTreeSnapshot(value: unknown): SessionTreeSnapshot {
  if (!value || typeof value !== "object") {
    return { currentLeafId: null, tree: [] };
  }

  const candidate = value as {
    currentLeafId?: unknown;
    entries?: unknown;
  };

  return {
    currentLeafId:
      typeof candidate.currentLeafId === "string"
        ? candidate.currentLeafId
        : null,
    tree: buildSessionTree(parseFlatSessionTreeNodes(candidate.entries)),
  };
}

export function parseNavigateSessionTreeResult(
  value: unknown,
): NavigateSessionTreeResult {
  if (!value || typeof value !== "object") {
    return {
      cancelled: true,
      summaryCreated: false,
    };
  }

  const candidate = value as {
    editorText?: unknown;
    cancelled?: unknown;
    aborted?: unknown;
    summaryCreated?: unknown;
  };

  return {
    editorText:
      typeof candidate.editorText === "string"
        ? candidate.editorText
        : undefined,
    cancelled: candidate.cancelled === true,
    aborted: candidate.aborted === true ? true : undefined,
    summaryCreated: candidate.summaryCreated === true,
  };
}

export function sortAvailableModels(
  models: AvailableModel[],
  currentProvider: string,
  currentModel: string,
): AvailableModel[] {
  return [...models].sort((a, b) => {
    const aIsCurrent = a.provider === currentProvider && a.id === currentModel;
    const bIsCurrent = b.provider === currentProvider && b.id === currentModel;

    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;

    const providerCompare = a.provider.localeCompare(b.provider);
    if (providerCompare !== 0) return providerCompare;

    return a.id.localeCompare(b.id);
  });
}
