import {
  normalizeScopePath,
  type PersistedSessionHistoryItem,
} from "$lib/stores/projectScopes.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";

export interface SessionBootstrapDependencies {
  isFloatingSessionWindow: boolean;
  boundSessionId: string | null;
  requestedSessionId: string | null;
  requestedSessionFile: string | null;
  refreshProjectScopes: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  getSessions: () => SessionDescriptor[];
  getActiveSession: () => SessionDescriptor | null;
  setActiveSession: (sessionId: string) => void;
  ensureRuntime: (descriptor: SessionDescriptor) => Promise<void>;
  createSession: (projectDir: string, sessionFile?: string) => Promise<void>;
  isProjectDirValid: (projectDir: string) => Promise<boolean>;
  getLastSelectedScope: () => string;
  getScopeHistory: (scope: string) => PersistedSessionHistoryItem[] | undefined;
  setProjectDirInput: (value: string) => void;
  requestScrollToBottom: () => void;
  setFloatingSessionMissing: (value: boolean) => void;
}

export async function bootstrapMainWindowSessions(
  dependencies: SessionBootstrapDependencies,
): Promise<void> {
  await dependencies.refreshProjectScopes().catch(() => undefined);
  await dependencies.refreshSessions().catch(() => undefined);

  for (const descriptor of dependencies.getSessions()) {
    await dependencies.ensureRuntime(descriptor);
  }

  if (dependencies.getSessions().length === 0) {
    const lastScope = normalizeScopePath(dependencies.getLastSelectedScope());

    if (
      lastScope.length > 0 &&
      (await dependencies.isProjectDirValid(lastScope))
    ) {
      const scopeHistory = dependencies.getScopeHistory(lastScope);
      const mostRecent = scopeHistory?.[0];

      if (mostRecent) {
        await dependencies.createSession(lastScope, mostRecent.filePath);
        return;
      }

      await dependencies.createSession(lastScope);
      return;
    }

    dependencies.setProjectDirInput("");
    return;
  } else {
    const requestedSessionId = dependencies.requestedSessionId?.trim() ?? "";
    if (requestedSessionId.length > 0) {
      const requestedSession = dependencies
        .getSessions()
        .find((session) => session.sessionId === requestedSessionId);

      if (requestedSession) {
        dependencies.setActiveSession(requestedSession.sessionId);
        await dependencies.ensureRuntime(requestedSession);
        dependencies.setProjectDirInput(requestedSession.projectDir);
        dependencies.requestScrollToBottom();
        return;
      }
    }

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

export async function bootstrapFloatingSessionWindow(
  sessionId: string,
  dependencies: SessionBootstrapDependencies,
): Promise<void> {
  dependencies.setFloatingSessionMissing(false);

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
    dependencies.setFloatingSessionMissing(true);
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
  if (dependencies.isFloatingSessionWindow) {
    if (!dependencies.boundSessionId) {
      dependencies.setFloatingSessionMissing(true);
      return;
    }

    await bootstrapFloatingSessionWindow(
      dependencies.boundSessionId,
      dependencies,
    );
    return;
  }

  await bootstrapMainWindowSessions(dependencies);
}
