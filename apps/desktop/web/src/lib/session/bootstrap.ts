import {
  normalizeScopePath,
  type PersistedSessionHistoryItem,
} from "$lib/stores/projectScopes.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";

export interface SessionBootstrapDependencies {
  isCompactSessionWindow: boolean;
  boundSessionId: string | null;
  requestedSessionFile: string | null;
  loadCwd: () => Promise<void>;
  refreshProjectScopes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  getSessions: () => SessionDescriptor[];
  getActiveSession: () => SessionDescriptor | null;
  setActiveSession: (sessionId: string) => void;
  ensureRuntime: (descriptor: SessionDescriptor) => Promise<void>;
  createSession: (projectDir: string, sessionFile?: string) => Promise<void>;
  getWorkingDirectory: () => Promise<string>;
  getLastSelectedScope: () => string;
  getScopeHistory: (scope: string) => PersistedSessionHistoryItem[] | undefined;
  setProjectDirInput: (value: string) => void;
  requestScrollToBottom: () => void;
  setCompactSessionMissing: (value: boolean) => void;
}

export async function bootstrapMainWindowSessions(
  dependencies: SessionBootstrapDependencies,
): Promise<void> {
  await dependencies.loadCwd();

  await dependencies.refreshProjectScopes().catch(() => undefined);
  await dependencies.refreshSessions().catch(() => undefined);

  for (const descriptor of dependencies.getSessions()) {
    await dependencies.ensureRuntime(descriptor);
  }

  if (dependencies.getSessions().length === 0) {
    // Prefer the last selected scope from settings, fall back to cwd
    const lastScope = dependencies.getLastSelectedScope();
    const cwdFallback = await dependencies.getWorkingDirectory();

    // Use last selected scope if it exists and has known history.
    let projectDir = cwdFallback;
    if (lastScope && lastScope.trim().length > 0) {
      try {
        const scopeHistory = dependencies.getScopeHistory(lastScope);
        const hasHistory = scopeHistory && scopeHistory.length > 0;

        if (hasHistory) {
          // Resume the most recent session for this scope
          const mostRecent = scopeHistory[0];
          if (mostRecent) {
            await dependencies.createSession(lastScope, mostRecent.filePath);
            return;
          }
        }

        // No history - start fresh with the last selected scope
        projectDir = lastScope;
      } catch {
        // Fall back to cwd if lastScope is invalid
      }
    }

    await dependencies.createSession(projectDir);
  } else {
    // Sessions exist - try to activate the last selected scope if it matches
    const lastScope = dependencies.getLastSelectedScope();
    if (lastScope && lastScope.trim().length > 0) {
      const normalizedLast = normalizeScopePath(lastScope);
      const matchingSession = dependencies
        .getSessions()
        .find(
          (session) =>
            normalizeScopePath(session.projectDir) === normalizedLast,
        );

      if (matchingSession) {
        dependencies.setActiveSession(matchingSession.sessionId);
        await dependencies.ensureRuntime(matchingSession);
        dependencies.setProjectDirInput(matchingSession.projectDir);
        dependencies.requestScrollToBottom();
        return;
      }
    }

    // No match - use the active session selected by backend refresh.
    const active = dependencies.getActiveSession();
    if (active) {
      await dependencies.ensureRuntime(active);
    }
  }

  const active = dependencies.getActiveSession();
  if (active) {
    dependencies.setProjectDirInput(active.projectDir);
    dependencies.requestScrollToBottom();
  }
}

export async function bootstrapCompactSessionWindow(
  sessionId: string,
  dependencies: SessionBootstrapDependencies,
): Promise<void> {
  dependencies.setCompactSessionMissing(false);

  await dependencies.loadCwd();
  await dependencies.refreshSessions().catch(() => undefined);

  const requestedSessionFile = dependencies.requestedSessionFile?.trim() ?? "";

  const descriptor =
    dependencies
      .getSessions()
      .find((session) => session.sessionId === sessionId) ??
    (requestedSessionFile.length > 0
      ? dependencies
          .getSessions()
          .find((session) => session.sessionFile === requestedSessionFile)
      : undefined);

  if (!descriptor) {
    dependencies.setCompactSessionMissing(true);
    return;
  }

  dependencies.setActiveSession(descriptor.sessionId);
  await dependencies.ensureRuntime(descriptor);
  dependencies.setProjectDirInput(descriptor.projectDir);
  dependencies.requestScrollToBottom();
}

export async function bootstrapSessions(
  dependencies: SessionBootstrapDependencies,
): Promise<void> {
  if (dependencies.isCompactSessionWindow) {
    if (!dependencies.boundSessionId) {
      dependencies.setCompactSessionMissing(true);
      return;
    }

    await bootstrapCompactSessionWindow(
      dependencies.boundSessionId,
      dependencies,
    );
    return;
  }

  await bootstrapMainWindowSessions(dependencies);
}
