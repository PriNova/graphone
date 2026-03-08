import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";
import type { SessionAttentionSubject } from "$lib/stores/sessionAttention.svelte";
import type { SessionRuntime } from "$lib/types/session";

export function subjectFromSessionDescriptor(
  descriptor: SessionDescriptor | null | undefined,
): SessionAttentionSubject | null {
  if (!descriptor) {
    return null;
  }

  return {
    sessionFile: descriptor.sessionFile ?? null,
    sessionId: descriptor.sessionId,
  };
}

export function subjectFromPersistedHistory(
  history: PersistedSessionHistoryItem | null | undefined,
): SessionAttentionSubject | null {
  if (!history) {
    return null;
  }

  return {
    sessionFile: history.filePath,
    persistedSessionId: history.sessionId,
    sessionId: history.sessionId,
  };
}

export function subjectFromSessionRuntime(
  runtime: SessionRuntime | null | undefined,
): SessionAttentionSubject | null {
  if (!runtime) {
    return null;
  }

  return {
    persistedSessionId: runtime.agent.persistedSessionId,
    sessionId: runtime.sessionId,
  };
}

export function mergeSessionAttentionSubjects(
  ...subjects: Array<SessionAttentionSubject | null | undefined>
): SessionAttentionSubject | null {
  const merged: SessionAttentionSubject = {};

  for (const subject of subjects) {
    if (!subject) {
      continue;
    }

    if (!merged.sessionFile && subject.sessionFile) {
      merged.sessionFile = subject.sessionFile;
    }

    if (!merged.persistedSessionId && subject.persistedSessionId) {
      merged.persistedSessionId = subject.persistedSessionId;
    }

    if (!merged.sessionId && subject.sessionId) {
      merged.sessionId = subject.sessionId;
    }
  }

  return merged.sessionFile || merged.persistedSessionId || merged.sessionId
    ? merged
    : null;
}

export function isSessionVisibleInCurrentWindow(args: {
  runtime: SessionRuntime | null | undefined;
  activeSessionId: string | null | undefined;
  isWindowFocused: boolean;
  isFloatingSessionWindow: boolean;
  boundSessionId: string | null | undefined;
}): boolean {
  if (!args.runtime || !args.isWindowFocused) {
    return false;
  }

  if (args.isFloatingSessionWindow) {
    const boundSessionId = args.boundSessionId?.trim() ?? "";
    return (
      boundSessionId.length > 0 &&
      args.runtime.sessionId.trim() === boundSessionId
    );
  }

  const activeSessionId = args.activeSessionId?.trim() ?? "";
  return (
    activeSessionId.length > 0 &&
    args.runtime.sessionId.trim() === activeSessionId
  );
}
