import {
  normalizeScopePath,
  type PersistedSessionHistoryItem,
} from "$lib/stores/projectScopes.svelte";
import type { RestorableOpenSessionTab } from "$lib/stores/settings.svelte";
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
  createSession: (
    projectDir: string,
    sessionFile?: string,
    options?: { activate?: boolean },
  ) => Promise<SessionDescriptor>;
  isProjectDirValid: (projectDir: string) => Promise<boolean>;
  getLastSelectedScope: () => string;
  getRestorableOpenSessionTabs: () => RestorableOpenSessionTab[];
  getRestorableOpenSessionActiveIndex: () => number;
  getScopeHistory: (scope: string) => PersistedSessionHistoryItem[] | undefined;
  setProjectDirInput: (value: string) => void;
  requestScrollToBottom: () => void;
  setFloatingSessionMissing: (value: boolean) => void;
}

async function restoreOpenTabsFromSettings(
  dependencies: SessionBootstrapDependencies,
): Promise<boolean> {
  const openTabs = dependencies.getRestorableOpenSessionTabs();
  if (openTabs.length === 0) {
    return false;
  }

  const restored: SessionDescriptor[] = [];

  for (const tab of openTabs) {
    const projectDir = normalizeScopePath(tab.projectDir);
    if (
      projectDir.length === 0 ||
      !(await dependencies.isProjectDirValid(projectDir))
    ) {
      continue;
    }

    const requestedSessionFile = tab.sessionFile?.trim() ?? "";
    const scopeHistory = dependencies.getScopeHistory(projectDir) ?? [];
    const matchedHistory =
      requestedSessionFile.length > 0
        ? scopeHistory.find(
            (history) => history.filePath.trim() === requestedSessionFile,
          )
        : undefined;

    try {
      const descriptor = await dependencies.createSession(
        projectDir,
        matchedHistory?.filePath,
        { activate: false },
      );
      restored.push(descriptor);
    } catch (error) {
      if (requestedSessionFile.length === 0) {
        console.warn("Failed to restore open session tab:", error);
        continue;
      }

      try {
        const descriptor = await dependencies.createSession(
          projectDir,
          undefined,
          {
            activate: false,
          },
        );
        restored.push(descriptor);
      } catch (fallbackError) {
        console.warn("Failed to restore open session tab:", fallbackError);
      }
    }
  }

  if (restored.length === 0) {
    return false;
  }

  const requestedActiveIndex =
    dependencies.getRestorableOpenSessionActiveIndex();
  const activeIndex = Math.min(
    Math.max(requestedActiveIndex, 0),
    restored.length - 1,
  );
  const activeDescriptor = restored[activeIndex] ?? restored[0];

  if (!activeDescriptor) {
    return false;
  }

  dependencies.setActiveSession(activeDescriptor.sessionId);
  await dependencies.ensureRuntime(activeDescriptor);
  dependencies.setProjectDirInput(activeDescriptor.projectDir);
  dependencies.requestScrollToBottom();
  return true;
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
    if (await restoreOpenTabsFromSettings(dependencies)) {
      return;
    }

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
