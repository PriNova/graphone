import type { SessionDescriptor } from "$lib/stores/sessions.svelte";

export interface SessionSelectionRecoveryDependencies {
  refreshSessions: () => Promise<void>;
  getSessions: () => SessionDescriptor[];
  getActiveSession: () => SessionDescriptor | null;
  setActiveSession: (sessionId: string) => void;
  ensureRuntime: (descriptor: SessionDescriptor) => Promise<void>;
  createSession: (projectDir: string) => Promise<void>;
  getWorkingDirectoryFallback: () => Promise<string>;
  requestScrollToBottom: () => void;
}

export async function recoverSessionSelectionAfterMutation(
  dependencies: SessionSelectionRecoveryDependencies,
): Promise<void> {
  await dependencies.refreshSessions().catch(() => undefined);

  if (dependencies.getSessions().length === 0) {
    const fallback = await dependencies.getWorkingDirectoryFallback();
    await dependencies.createSession(fallback);
    return;
  }

  if (dependencies.getActiveSession()) {
    return;
  }

  const first = dependencies.getSessions()[0];
  if (!first) {
    return;
  }

  dependencies.setActiveSession(first.sessionId);
  await dependencies.ensureRuntime(first);
  dependencies.requestScrollToBottom();
}
