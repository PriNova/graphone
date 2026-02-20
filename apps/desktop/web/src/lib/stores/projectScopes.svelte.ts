import { invoke } from "@tauri-apps/api/core";

export interface PersistedSessionHistoryItem {
  sessionId: string;
  timestamp?: string;
  firstUserMessage?: string;
  source: "global" | "local" | "unknown";
  filePath: string;
}

interface SessionProjectScopesResponse {
  scopes?: unknown;
  histories?: unknown;
}

interface DeleteProjectSessionResponse {
  deleted?: unknown;
}

function normalizeScopePath(path: string): string {
  return path.trim().replace(/[\\/]+$/, "");
}

export { normalizeScopePath };

function normalizeScopes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedup = new Set<string>();

  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const normalized = normalizeScopePath(entry);
    if (!normalized) {
      continue;
    }

    dedup.add(normalized);
  }

  return [...dedup].sort((a, b) => a.localeCompare(b));
}

function normalizeHistories(
  value: unknown,
): Record<string, PersistedSessionHistoryItem[]> {
  if (!Array.isArray(value)) {
    return {};
  }

  const grouped = new Map<string, PersistedSessionHistoryItem[]>();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const scopeValue = (entry as { scope?: unknown }).scope;
    const scope =
      typeof scopeValue === "string" ? normalizeScopePath(scopeValue) : "";
    if (!scope) {
      continue;
    }

    const sessionsValue = (entry as { sessions?: unknown }).sessions;
    if (!Array.isArray(sessionsValue)) {
      grouped.set(scope, []);
      continue;
    }

    const dedup = new Set<string>();
    const normalized: PersistedSessionHistoryItem[] = [];

    for (const session of sessionsValue) {
      if (!session || typeof session !== "object") {
        continue;
      }

      const rawSessionId =
        (session as { sessionId?: unknown; session_id?: unknown }).sessionId ??
        (session as { session_id?: unknown }).session_id;
      const rawFilePath =
        (session as { filePath?: unknown; file_path?: unknown }).filePath ??
        (session as { file_path?: unknown }).file_path;

      const sessionId =
        typeof rawSessionId === "string" ? rawSessionId.trim() : "";
      const filePath =
        typeof rawFilePath === "string" ? rawFilePath.trim() : "";

      if (!sessionId || !filePath) {
        continue;
      }

      const rawTimestamp = (session as { timestamp?: unknown }).timestamp;
      const timestamp =
        typeof rawTimestamp === "string" && rawTimestamp.trim().length > 0
          ? rawTimestamp.trim()
          : undefined;

      const rawFirstUserMessage =
        (
          session as {
            firstUserMessage?: unknown;
            first_user_message?: unknown;
          }
        ).firstUserMessage ??
        (session as { first_user_message?: unknown }).first_user_message;
      const firstUserMessage =
        typeof rawFirstUserMessage === "string" &&
        rawFirstUserMessage.trim().length > 0
          ? rawFirstUserMessage.trim()
          : undefined;

      const rawSource = (session as { source?: unknown }).source;
      const source =
        rawSource === "global" || rawSource === "local" ? rawSource : "unknown";

      const dedupKey = `${sessionId}::${filePath}`;
      if (dedup.has(dedupKey)) {
        continue;
      }
      dedup.add(dedupKey);

      normalized.push({
        sessionId,
        timestamp,
        firstUserMessage,
        source,
        filePath,
      });
    }

    normalized.sort((a, b) => {
      const timestampCmp = (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
      if (timestampCmp !== 0) {
        return timestampCmp;
      }
      return a.sessionId.localeCompare(b.sessionId);
    });

    grouped.set(scope, normalized);
  }

  return Object.fromEntries(grouped.entries());
}

export class ProjectScopesStore {
  scopes = $state<string[]>([]);
  historyByScope = $state<Record<string, PersistedSessionHistoryItem[]>>({});
  loading = $state(false);
  error = $state<string | null>(null);

  getHistory(scope: string): PersistedSessionHistoryItem[] {
    return this.historyByScope[scope] ?? [];
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = null;

    try {
      const response = await invoke<SessionProjectScopesResponse>(
        "list_session_project_scopes",
      );
      this.scopes = normalizeScopes(response?.scopes);
      this.historyByScope = normalizeHistories(response?.histories);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.scopes = [];
      this.historyByScope = {};
    } finally {
      this.loading = false;
    }
  }

  async deleteScope(projectDir: string): Promise<number> {
    const deletedCount = await invoke<number>("delete_project_scope", {
      projectDir,
    });
    await this.refresh();
    return deletedCount;
  }

  async deleteSession(
    projectDir: string,
    sessionId: string,
    filePath: string,
  ): Promise<boolean> {
    const response = await invoke<DeleteProjectSessionResponse>(
      "delete_project_session",
      {
        projectDir,
        sessionId,
        filePath,
      },
    );

    const deleted = response?.deleted;
    const wasDeleted = typeof deleted === "boolean" ? deleted : false;
    await this.refresh();
    return wasDeleted;
  }
}

export const projectScopesStore = new ProjectScopesStore();
