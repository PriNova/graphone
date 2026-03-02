import {
  normalizeScopePath,
  type PersistedSessionHistoryItem,
} from "$lib/stores/projectScopes.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";

export function mergeScopeHistory(
  persistedHistoryByScope: Record<string, PersistedSessionHistoryItem[]>,
  descriptors: SessionDescriptor[],
  optimisticBySession: Record<string, { text: string; timestamp: string }>,
): Record<string, PersistedSessionHistoryItem[]> {
  const merged: Record<string, PersistedSessionHistoryItem[]> = {};

  for (const [scope, history] of Object.entries(persistedHistoryByScope)) {
    merged[scope] = [...history];
  }

  for (const descriptor of descriptors) {
    const optimistic = optimisticBySession[descriptor.sessionId];
    if (!optimistic) {
      continue;
    }

    const filePath = descriptor.sessionFile?.trim() ?? "";
    if (filePath.length === 0) {
      continue;
    }

    const scope = normalizeScopePath(descriptor.projectDir);
    if (scope.length === 0) {
      continue;
    }

    const history = merged[scope] ?? (merged[scope] = []);
    const alreadyPresent = history.some(
      (entry) => entry.filePath.trim() === filePath,
    );
    if (alreadyPresent) {
      continue;
    }

    history.push({
      sessionId: descriptor.sessionId,
      timestamp: optimistic.timestamp,
      firstUserMessage:
        optimistic.text.length > 0 ? optimistic.text : undefined,
      source: "unknown",
      filePath,
    });
  }

  for (const history of Object.values(merged)) {
    history.sort((a, b) => {
      const timestampCmp = (b.timestamp ?? "").localeCompare(a.timestamp ?? "");
      if (timestampCmp !== 0) {
        return timestampCmp;
      }
      return a.sessionId.localeCompare(b.sessionId);
    });
  }

  return merged;
}

export function hasPersistedSessionHistory(
  sessionId: string,
  descriptors: SessionDescriptor[],
  historyByScope: Record<string, PersistedSessionHistoryItem[]>,
): boolean {
  const descriptor = descriptors.find(
    (session) => session.sessionId === sessionId,
  );

  if (!descriptor) {
    return true;
  }

  const sessionFile = descriptor.sessionFile?.trim() ?? "";
  if (sessionFile.length === 0) {
    return true;
  }

  const scope = normalizeScopePath(descriptor.projectDir);
  const history = historyByScope[scope] ?? [];

  return history.some((entry) => entry.filePath.trim() === sessionFile);
}

export function toScopeTitle(projectDir: string | null): string {
  if (!projectDir) {
    return "No active scope";
  }

  const trimmed = projectDir.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? projectDir;
}
