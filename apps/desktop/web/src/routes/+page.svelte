<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { open } from "@tauri-apps/plugin-dialog";
  import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";

  import MainChatLayout from "$lib/components/layout/MainChatLayout.svelte";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import { setupAgentEventBridge } from "$lib/handlers/agent-event-bridge";
  import {
    handlePromptSubmit,
    handleSlashCommand,
    parseBangCommand,
  } from "$lib/handlers/commands";
  import {
    isSessionVisibleInCurrentWindow,
    mergeSessionAttentionSubjects,
    subjectFromPersistedHistory,
    subjectFromSessionDescriptor,
    subjectFromSessionRuntime,
  } from "$lib/session/attention";
  import { bootstrapSessions } from "$lib/session/bootstrap";
  import { recoverSessionSelectionAfterMutation } from "$lib/session/post-mutation-recovery";
  import {
    hasPersistedSessionHistory,
    mergeScopeHistory,
  } from "$lib/session/scope-history";
  import {
    ensureRuntime as ensureSessionRuntime,
    loadMessages,
    removeRuntimeForSession,
    type SessionRuntimeMap,
  } from "$lib/session/runtime-manager";
  import { deriveSessionTabs } from "$lib/session/session-tab-presentation";
  import { getAvailableSlashCommands } from "$lib/slash-commands";
  import type { ThinkingLevel } from "$lib/stores/agent.svelte";
  import {
    projectScopesStore,
    type PersistedSessionHistoryItem,
    normalizeScopePath,
  } from "$lib/stores/projectScopes.svelte";
  import {
    sessionsStore,
    type SessionDescriptor,
  } from "$lib/stores/sessions.svelte";
  import { sessionAttentionStore } from "$lib/stores/sessionAttention.svelte";
  import {
    settingsStore,
    type RestorableOpenSessionTab,
  } from "$lib/stores/settings.svelte";
  import { broadcastUiTheme, type UiTheme } from "$lib/theme/app-theme";
  import type { PromptImageAttachment } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";
  import {
    listOpenFloatingSessionWindowLabels,
    openOrFocusFloatingSessionWindow,
    toFloatingSessionWindowLabel,
  } from "$lib/windowing/session-windows";
  import { getCurrentWindowContext } from "$lib/windowing/window-context";

  // DOM refs
  let messagesContainerRef = $state<HTMLDivElement | null>(null);
  let messagesContentRef = $state<HTMLDivElement | null>(null);

  // Event unlistener
  let disposeAgentEventBridge: (() => void) | null = null;
  let disposeWindowFocusChanged: (() => void) | null = null;
  let detachedSessionRefreshTimer: ReturnType<typeof setInterval> | null = null;

  let sessionRuntimes = $state<SessionRuntimeMap>({});
  let projectDirInput = $state("");
  let startupError = $state<string | null>(null);
  let sessionsBootstrapped = $state(false);
  let sidebarCollapsed = $state(false);
  let sessionSidebarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingSessionSidebarSync = new Set<string>();
  let optimisticFirstPromptBySession = $state<
    Record<string, { text: string; timestamp: string }>
  >({});
  let promptDraftBySession = $state<Record<string, string>>({});
  let promptAttachmentDraftBySession = $state<
    Record<string, PromptImageAttachment[]>
  >({});
  let openSessionTabOrder = $state<string[]>([]);
  let lastPersistedOpenTabsSignature = $state<string>("");
  let detachedSessionIds = $state<string[]>([]);
  let floatingSessionMissing = $state(false);
  let isWindowFocused = $state(
    typeof document === "undefined" ? true : document.hasFocus(),
  );
  const windowContext = getCurrentWindowContext();
  const isFloatingSessionWindow =
    windowContext.role === "floating-session-chat";
  const isMainWindow = windowContext.role === "main";
  const boundSessionId = windowContext.sessionId;
  const EMPTY_PROMPT_ATTACHMENTS: PromptImageAttachment[] = [];

  const sessions = $derived(sessionsStore.sessions);
  const activeSessionId = $derived(sessionsStore.activeSessionId);
  const activeSession = $derived(sessionsStore.activeSession);
  const activeSessionFile = $derived(activeSession?.sessionFile ?? null);
  const persistedProjectScopes = $derived(projectScopesStore.scopes);
  const scopeHistoryByProject = $derived(
    mergeScopeHistory(
      projectScopesStore.historyByScope,
      sessionsStore.sessions,
      optimisticFirstPromptBySession,
    ),
  );

  function areSessionIdListsEqual(left: string[], right: string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  function getRestorableOpenSessionTabs(): RestorableOpenSessionTab[] {
    const sessionsById = new Map(
      sessions.map((session) => [session.sessionId, session] as const),
    );

    return openSessionTabOrder
      .map((sessionId): RestorableOpenSessionTab | null => {
        const session = sessionsById.get(sessionId);
        if (!session) {
          return null;
        }

        const projectDir = normalizeScopePath(session.projectDir);
        if (projectDir.length === 0) {
          return null;
        }

        const sessionFile = session.sessionFile?.trim() ?? "";
        return sessionFile.length > 0
          ? { projectDir, sessionFile }
          : { projectDir };
      })
      .filter((entry): entry is RestorableOpenSessionTab => entry !== null);
  }

  function getRestorableOpenSessionActiveIndex(): number {
    if (!activeSessionId) {
      return 0;
    }

    const activeIndex = openSessionTabOrder.indexOf(activeSessionId);
    return activeIndex >= 0 ? activeIndex : 0;
  }

  $effect(() => {
    const validSessionIds = new Set(
      sessions.map((session) => session.sessionId),
    );
    const nextOrder = openSessionTabOrder.filter((sessionId) =>
      validSessionIds.has(sessionId),
    );

    for (const session of sessions) {
      if (!validSessionIds.has(session.sessionId)) {
        continue;
      }

      if (!nextOrder.includes(session.sessionId)) {
        nextOrder.push(session.sessionId);
      }
    }

    if (!areSessionIdListsEqual(openSessionTabOrder, nextOrder)) {
      openSessionTabOrder = nextOrder;
    }
  });

  $effect(() => {
    if (!isMainWindow || !settingsStore.loaded || !sessionsBootstrapped) {
      return;
    }

    const tabs = getRestorableOpenSessionTabs();
    const activeIndex = getRestorableOpenSessionActiveIndex();
    const signature = JSON.stringify({ tabs, activeIndex });

    if (signature === lastPersistedOpenTabsSignature) {
      return;
    }

    lastPersistedOpenTabsSignature = signature;
    void settingsStore
      .persistOpenSessionTabs(tabs, activeIndex)
      .catch((error) => {
        console.warn("Failed to persist open session tabs:", error);
      });
  });

  const orderedSessionTabs = $derived.by(() => {
    if (!isMainWindow) {
      return undefined;
    }

    return deriveSessionTabs({
      sessions,
      tabOrder: openSessionTabOrder,
      scopeHistoryByProject,
      busySessionIds,
      reviewSessionIds: reviewOpenSessionIds,
      detachedSessionIds,
    });
  });

  const projectScopes = $derived(
    [
      ...new Set([
        ...persistedProjectScopes.map(normalizeScopePath),
        ...sessions.map((session) => normalizeScopePath(session.projectDir)),
      ]),
    ].sort((a, b) => a.localeCompare(b)),
  );
  const activeRuntime = $derived(
    activeSessionId ? (sessionRuntimes[activeSessionId] ?? null) : null,
  );
  const activePromptDraft = $derived(
    activeSessionId ? (promptDraftBySession[activeSessionId] ?? "") : "",
  );
  const activePromptAttachmentDraft = $derived(
    activeSessionId
      ? (promptAttachmentDraftBySession[activeSessionId] ??
          EMPTY_PROMPT_ATTACHMENTS)
      : EMPTY_PROMPT_ATTACHMENTS,
  );

  const messages = $derived(
    activeRuntime ? activeRuntime.messages.messages : [],
  );
  const isLoading = $derived(
    activeRuntime ? activeRuntime.agent.isLoading : false,
  );
  const sessionStarted = $derived(
    activeRuntime ? activeRuntime.agent.sessionStarted : false,
  );
  const currentModel = $derived(
    activeRuntime ? activeRuntime.agent.currentModel : "",
  );
  const currentProvider = $derived(
    activeRuntime ? activeRuntime.agent.currentProvider : "",
  );
  const currentThinkingLevel = $derived(
    activeRuntime ? activeRuntime.agent.currentThinkingLevel : "off",
  );
  const supportsThinking = $derived(
    activeRuntime ? activeRuntime.agent.supportsThinking : false,
  );
  const availableThinkingLevels = $derived(
    activeRuntime
      ? activeRuntime.agent.availableThinkingLevels
      : (["off"] as ThinkingLevel[]),
  );
  const availableModels = $derived(
    activeRuntime ? activeRuntime.agent.availableModels : [],
  );
  const isModelsLoading = $derived(
    activeRuntime ? activeRuntime.agent.isModelsLoading : false,
  );
  const isSettingModel = $derived(
    activeRuntime ? activeRuntime.agent.isSettingModel : false,
  );
  const isSettingThinking = $derived(
    activeRuntime ? activeRuntime.agent.isSettingThinking : false,
  );
  const currentModelSupportsImageInput = $derived(
    activeRuntime ? activeRuntime.agent.supportsImageInput : false,
  );
  const chatHasMessages = $derived(messages.length > 0);
  const usageIndicator = $derived(
    activeRuntime ? activeRuntime.agent.usageIndicator : null,
  );
  const runtimeSlashCommands = $derived(
    activeRuntime ? activeRuntime.agent.availableSlashCommands : [],
  );
  const slashCommands = $derived(
    getAvailableSlashCommands(runtimeSlashCommands),
  );
  const isExtensionsLoading = $derived(
    activeRuntime ? activeRuntime.agent.isExtensionsLoading : false,
  );
  const extensionsLoadError = $derived(
    activeRuntime ? activeRuntime.agent.extensionsLoadError : null,
  );
  const globalExtensions = $derived(
    activeRuntime ? activeRuntime.agent.globalExtensions : [],
  );
  const localExtensions = $derived(
    activeRuntime ? activeRuntime.agent.localExtensions : [],
  );
  const extensionLoadDiagnostics = $derived(
    activeRuntime ? activeRuntime.agent.extensionLoadDiagnostics : [],
  );
  const activeProjectDir = $derived(
    activeRuntime ? normalizeScopePath(activeRuntime.projectDir) : null,
  );
  const busySessionIds = $derived.by(() => {
    const busy = new Set<string>();

    for (const session of sessionsStore.sessions) {
      if (session.busy || sessionRuntimes[session.sessionId]?.agent.isLoading) {
        busy.add(session.sessionId);
      }
    }

    for (const [sessionId, runtime] of Object.entries(sessionRuntimes)) {
      if (!runtime.agent.isLoading) {
        continue;
      }

      busy.add(sessionId);

      const persistedSessionId = runtime.agent.persistedSessionId?.trim() ?? "";
      if (persistedSessionId.length > 0) {
        busy.add(persistedSessionId);
      }
    }

    return Array.from(busy);
  });
  const busySessionFiles = $derived.by(() => {
    const busy = new Set<string>();

    for (const session of sessionsStore.sessions) {
      const sessionFile = session.sessionFile?.trim() ?? "";
      if (sessionFile.length === 0) {
        continue;
      }

      if (session.busy || sessionRuntimes[session.sessionId]?.agent.isLoading) {
        busy.add(sessionFile);
      }
    }

    return Array.from(busy);
  });
  const reviewOpenSessionIds = $derived.by(() => {
    const review = new Set<string>();

    for (const session of sessions) {
      if (
        !sessionAttentionStore.needsReview(
          getAttentionSubjectForDescriptor(session),
        )
      ) {
        continue;
      }

      review.add(session.sessionId);
    }

    return Array.from(review);
  });
  const reviewSessionIds = $derived.by(() => {
    const review = new Set<string>();

    for (const history of Object.values(scopeHistoryByProject).flat()) {
      if (
        !sessionAttentionStore.needsReview(subjectFromPersistedHistory(history))
      ) {
        continue;
      }

      review.add(history.sessionId);
    }

    return Array.from(review);
  });
  const reviewSessionFiles = $derived.by(() => {
    const review = new Set<string>();

    for (const history of Object.values(scopeHistoryByProject).flat()) {
      if (
        !sessionAttentionStore.needsReview(subjectFromPersistedHistory(history))
      ) {
        continue;
      }

      const filePath = history.filePath.trim();
      if (filePath.length > 0) {
        review.add(filePath);
      }
    }

    return Array.from(review);
  });
  const showSidebarInLayout = $derived(isMainWindow);
  const showPopOutActiveSessionButton = $derived(isMainWindow);
  const showHeaderInLayout = $derived(!isFloatingSessionWindow);
  const layoutWindowTitleHint = $derived(
    isFloatingSessionWindow ? "Floating isolated session" : null,
  );
  const layoutEmptyStateText = $derived.by(() => {
    if (isFloatingSessionWindow && floatingSessionMissing) {
      return "This floating session is no longer available.";
    }

    if (projectScopes.length === 0) {
      return "No project scope yet. Create one to start chatting.";
    }

    return "Select or create a project scope to start chatting.";
  });

  function getAttentionSubjectForDescriptor(
    descriptor: SessionDescriptor | null | undefined,
  ) {
    if (!descriptor) {
      return null;
    }

    return mergeSessionAttentionSubjects(
      subjectFromSessionDescriptor(descriptor),
      subjectFromSessionRuntime(sessionRuntimes[descriptor.sessionId]),
    );
  }

  function getAttentionSubjectForHistory(
    history: PersistedSessionHistoryItem | null | undefined,
  ) {
    if (!history) {
      return null;
    }

    const matchingSession = sessionsStore.sessions.find(
      (session) => session.sessionFile === history.filePath,
    );

    return mergeSessionAttentionSubjects(
      subjectFromPersistedHistory(history),
      subjectFromSessionDescriptor(matchingSession),
      matchingSession
        ? subjectFromSessionRuntime(sessionRuntimes[matchingSession.sessionId])
        : null,
    );
  }

  function getAttentionSubjectForRuntime(
    runtime: SessionRuntime | null | undefined,
  ) {
    if (!runtime) {
      return null;
    }

    const matchingSession = sessionsStore.sessions.find(
      (session) => session.sessionId === runtime.sessionId,
    );

    return mergeSessionAttentionSubjects(
      subjectFromSessionRuntime(runtime),
      subjectFromSessionDescriptor(matchingSession),
    );
  }

  async function isSessionVisibleInAnyFocusedWindow(
    sessionId: string,
  ): Promise<boolean> {
    const normalizedSessionId = sessionId.trim();
    if (normalizedSessionId.length === 0) {
      return false;
    }

    if (
      isWindowFocused &&
      activeSessionId?.trim() === normalizedSessionId &&
      isMainWindow
    ) {
      return true;
    }

    const floatingLabel = toFloatingSessionWindowLabel(normalizedSessionId);
    const windows = await getAllWindows().catch(() => []);

    for (const window of windows) {
      if (window.label !== floatingLabel) {
        continue;
      }

      const focused = await window.isFocused().catch(() => false);
      if (focused) {
        return true;
      }
    }

    return false;
  }

  async function markVisibleSessionSeen(): Promise<void> {
    if (!isWindowFocused) {
      return;
    }

    const visibleSession = isFloatingSessionWindow
      ? boundSessionId
        ? (sessionsStore.sessions.find(
            (session) => session.sessionId === boundSessionId,
          ) ?? null)
        : null
      : activeSession;

    const subject = getAttentionSubjectForDescriptor(visibleSession);
    if (!sessionAttentionStore.needsReview(subject)) {
      return;
    }

    await sessionAttentionStore.markSeen(subject);
  }

  $effect(() => {
    const shouldTrackVisibleSession =
      (isFloatingSessionWindow && boundSessionId) ||
      (!isFloatingSessionWindow && activeSessionId);

    if (!shouldTrackVisibleSession || !isWindowFocused) {
      return;
    }

    void markVisibleSessionSeen().catch(() => undefined);
  });

  function handleScroll(): void {
    if (messagesContainerRef && activeRuntime) {
      activeRuntime.messages.updateScrollPosition(messagesContainerRef);
    }
  }

  // `force` is used when activating/opening a session so restored per-session
  // pin state does not block the initial jump to the latest message.
  function scrollToBottom(smooth = true, force = false): void {
    activeRuntime?.messages.scrollToBottom(messagesContainerRef, smooth, force);
  }

  // Performance: Debounced scroll using RAF throttling.
  // Prevents multiple scroll operations per animation frame during
  // high-frequency streaming events (text_delta, thinking_delta).
  // Use instant scroll here for reliability while content grows rapidly;
  // smooth scrolling can fall behind and temporarily mark the view as unpinned.
  let scrollRaf: number | null = null;
  let resizeScrollRaf: number | null = null;

  function scheduleScrollToBottom(): void {
    if (scrollRaf === null) {
      scrollRaf = requestAnimationFrame(() => {
        scrollToBottom(false);
        scrollRaf = null;
      });
    }
  }

  function schedulePinnedResizeScroll(): void {
    if (resizeScrollRaf !== null) {
      return;
    }

    resizeScrollRaf = requestAnimationFrame(() => {
      resizeScrollRaf = null;

      if (!messagesContainerRef || !activeRuntime) {
        return;
      }

      if (!activeRuntime.messages.isPinnedToBottom()) {
        return;
      }

      activeRuntime.messages.scrollToBottom(messagesContainerRef, false);
    });
  }

  $effect(() => {
    const contentElement = messagesContentRef;
    if (!contentElement) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      schedulePinnedResizeScroll();
    });

    resizeObserver.observe(contentElement);

    return () => {
      resizeObserver.disconnect();
    };
  });

  function maybeTrackOptimisticFirstPrompt(
    runtime: SessionRuntime,
    prompt: string,
  ): void {
    const alreadyHasUserMessages = runtime.messages.messages.some(
      (message) => message.type === "user",
    );
    if (alreadyHasUserMessages) {
      return;
    }

    if (optimisticFirstPromptBySession[runtime.sessionId]) {
      return;
    }

    const trimmed = prompt.trim();
    if (trimmed.length === 0) {
      return;
    }

    optimisticFirstPromptBySession = {
      ...optimisticFirstPromptBySession,
      [runtime.sessionId]: {
        text: trimmed,
        timestamp: new Date().toISOString(),
      },
    };
  }

  function clearOptimisticFirstPrompt(sessionId: string): void {
    if (!optimisticFirstPromptBySession[sessionId]) {
      return;
    }

    const remaining = { ...optimisticFirstPromptBySession };
    delete remaining[sessionId];
    optimisticFirstPromptBySession = remaining;
  }

  function reconcilePendingSessionSidebarSync(): void {
    for (const sessionId of pendingSessionSidebarSync) {
      if (
        hasPersistedSessionHistory(
          sessionId,
          sessionsStore.sessions,
          projectScopesStore.historyByScope,
        )
      ) {
        pendingSessionSidebarSync.delete(sessionId);
        clearOptimisticFirstPrompt(sessionId);
      }
    }
  }

  function scheduleSessionSidebarRefresh(delayMs = 450): void {
    if (sessionSidebarRefreshTimer) {
      clearTimeout(sessionSidebarRefreshTimer);
      sessionSidebarRefreshTimer = null;
    }

    sessionSidebarRefreshTimer = setTimeout(() => {
      sessionSidebarRefreshTimer = null;

      // Only refresh project scopes to pick up newly persisted session files.
      // Do NOT refresh sessionsStore - the session is already tracked locally
      // and refreshFromBackend() would replace the list, potentially losing
      // the active session if there's a timing issue with the backend.
      void projectScopesStore
        .refresh()
        .then(() => {
          reconcilePendingSessionSidebarSync();
        })
        .catch(() => undefined);
    }, delayMs);
  }

  async function ensureRuntime(
    descriptor: SessionDescriptor,
  ): Promise<SessionRuntime> {
    return ensureSessionRuntime(descriptor, sessionRuntimes, (next) => {
      sessionRuntimes = next;
    });
  }

  function cleanupClosedSessionState(sessionId: string): void {
    sessionRuntimes = removeRuntimeForSession(sessionRuntimes, sessionId);
    pendingSessionSidebarSync.delete(sessionId);
    clearOptimisticFirstPrompt(sessionId);

    if (Object.hasOwn(promptDraftBySession, sessionId)) {
      const remainingDrafts = { ...promptDraftBySession };
      delete remainingDrafts[sessionId];
      promptDraftBySession = remainingDrafts;
    }

    if (Object.hasOwn(promptAttachmentDraftBySession, sessionId)) {
      const remainingAttachments = { ...promptAttachmentDraftBySession };
      delete remainingAttachments[sessionId];
      promptAttachmentDraftBySession = remainingAttachments;
    }

    openSessionTabOrder = openSessionTabOrder.filter((id) => id !== sessionId);
    detachedSessionIds = detachedSessionIds.filter((id) => id !== sessionId);
  }

  function getNeighboringTabSessionId(sessionId: string): string | null {
    const currentOrder = openSessionTabOrder.filter((id) =>
      sessions.some((session) => session.sessionId === id),
    );
    const currentIndex = currentOrder.indexOf(sessionId);

    if (currentIndex === -1) {
      return null;
    }

    return (
      currentOrder[currentIndex + 1] ?? currentOrder[currentIndex - 1] ?? null
    );
  }

  async function refreshDetachedSessionIds(): Promise<void> {
    if (!isMainWindow) {
      return;
    }

    const openLabels = new Set(await listOpenFloatingSessionWindowLabels());
    const nextDetached = sessions
      .map((session) => session.sessionId)
      .filter((sessionId) =>
        openLabels.has(toFloatingSessionWindowLabel(sessionId)),
      );

    if (!areSessionIdListsEqual(detachedSessionIds, nextDetached)) {
      detachedSessionIds = nextDetached;
    }
  }

  async function closeSessionWithTabBehavior(sessionId: string): Promise<void> {
    const sessionToClose = sessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (!sessionToClose) {
      return;
    }

    const activeBeforeClose = sessionsStore.activeSessionId;
    const nextActiveSessionId =
      activeBeforeClose === sessionId
        ? getNeighboringTabSessionId(sessionId)
        : activeBeforeClose;

    await sessionsStore.closeSession(sessionId);
    cleanupClosedSessionState(sessionId);

    if (!nextActiveSessionId) {
      return;
    }

    const nextDescriptor = sessionsStore.sessions.find(
      (session) => session.sessionId === nextActiveSessionId,
    );
    if (!nextDescriptor) {
      return;
    }

    sessionsStore.setActiveSession(nextActiveSessionId);
    await ensureRuntime(nextDescriptor);

    if (activeBeforeClose === sessionId) {
      requestAnimationFrame(() => scrollToBottom(false, true));
    }
  }

  function getProjectScopeSeedScopes(): string[] {
    const seedScopes = new Set<string>();

    const lastSelected = normalizeScopePath(settingsStore.lastSelectedScope);
    if (lastSelected.length > 0) {
      seedScopes.add(lastSelected);
    }

    for (const session of sessionsStore.sessions) {
      const scope = normalizeScopePath(session.projectDir);
      if (scope.length > 0) {
        seedScopes.add(scope);
      }
    }

    return [...seedScopes];
  }

  async function isProjectDirValid(projectDir: string): Promise<boolean> {
    try {
      return await invoke<boolean>("path_exists", { path: projectDir });
    } catch {
      return false;
    }
  }

  async function recoverSessionSelectionAfterScopeMutation(): Promise<void> {
    await recoverSessionSelectionAfterMutation({
      refreshSessions: () => sessionsStore.refreshFromBackend(),
      getSessions: () => sessionsStore.sessions,
      getActiveSession: () => sessionsStore.activeSession,
      setActiveSession: (sessionId) =>
        sessionsStore.setActiveSession(sessionId),
      ensureRuntime: async (descriptor) => {
        await ensureRuntime(descriptor);
      },
      setProjectDirInput: (value) => {
        projectDirInput = value;
      },
      requestScrollToBottom: () => {
        requestAnimationFrame(() => scrollToBottom(false, true));
      },
    });
  }

  async function createSession(
    projectDir: string,
    sessionFile?: string,
    options?: { activate?: boolean },
  ): Promise<SessionDescriptor> {
    const descriptor = await sessionsStore.createSession(
      projectDir,
      undefined,
      undefined,
      sessionFile,
      options,
    );
    await ensureRuntime(descriptor);
    projectDirInput = "";
    scheduleSessionSidebarRefresh(250);

    if (options?.activate ?? true) {
      requestAnimationFrame(() => scrollToBottom(false, true));
    }

    return descriptor;
  }

  async function getProjectScopeDialogDefaultPath(): Promise<
    string | undefined
  > {
    const candidates = [
      activeRuntime?.projectDir,
      activeSession?.projectDir,
      settingsStore.lastSelectedScope,
    ];

    for (const candidate of candidates) {
      const normalized = normalizeScopePath(candidate ?? "");
      if (normalized.length === 0) {
        continue;
      }

      if (await isProjectDirValid(normalized)) {
        return normalized;
      }
    }

    return undefined;
  }

  async function createProjectScope(): Promise<void> {
    const defaultPath = await getProjectScopeDialogDefaultPath();
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Create project scope",
      ...(defaultPath ? { defaultPath } : {}),
    });

    if (typeof selected !== "string") {
      return;
    }

    const projectDir = normalizeScopePath(selected);
    if (projectDir.length === 0) {
      return;
    }

    await createSession(projectDir);
  }

  async function onSelectSessionTab(sessionId: string): Promise<void> {
    const descriptor = sessionsStore.sessions.find(
      (session) => session.sessionId === sessionId,
    );
    if (!descriptor) {
      return;
    }

    sessionsStore.setActiveSession(sessionId);
    await ensureRuntime(descriptor);
    requestAnimationFrame(() => scrollToBottom(false, true));
  }

  async function onCloseSessionTab(sessionId: string): Promise<void> {
    await closeSessionWithTabBehavior(sessionId);
  }

  async function popOutSession(descriptor: SessionDescriptor): Promise<void> {
    await openOrFocusFloatingSessionWindow({
      sessionId: descriptor.sessionId,
      projectDir: descriptor.projectDir,
      sessionFile: descriptor.sessionFile,
    });
    await refreshDetachedSessionIds().catch(() => undefined);
  }

  async function onOpenHistoryInFloatingWindow(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const existing = sessionsStore.sessions.find(
      (session) => session.sessionFile === history.filePath,
    );

    const descriptor =
      existing ??
      (await sessionsStore.createSession(
        projectDir,
        undefined,
        undefined,
        history.filePath,
        { activate: false },
      ));

    if (!existing) {
      scheduleSessionSidebarRefresh(250);
    }

    await popOutSession(descriptor);
  }

  async function onPopOutActiveSession(): Promise<void> {
    const descriptor = sessionsStore.activeSession;
    if (!descriptor) {
      return;
    }

    await popOutSession(descriptor);
  }

  async function createSiblingFloatingSessionWindow(
    projectDir: string,
  ): Promise<void> {
    const descriptor = await sessionsStore.createSession(
      projectDir,
      undefined,
      undefined,
      undefined,
      { activate: false },
    );

    scheduleSessionSidebarRefresh(250);
    await popOutSession(descriptor);
  }

  function toggleSidebar(): void {
    sidebarCollapsed = !sidebarCollapsed;
  }

  async function onSelectScope(projectDir: string): Promise<void> {
    // Clicking a scope header should start a fresh chat for that scope.
    // Existing sessions are only resumed when selecting explicit history items.
    const normalizedTarget = normalizeScopePath(projectDir);
    if (
      activeRuntime &&
      normalizeScopePath(activeRuntime.projectDir) === normalizedTarget
    ) {
      return;
    }

    // Save last selected scope
    await settingsStore.setLastSelectedScope(normalizedTarget);

    await createSession(projectDir);
  }

  async function onSelectHistory(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const normalizedTarget = normalizeScopePath(projectDir);

    const existing = sessionsStore.sessions.find(
      (session) => session.sessionFile === history.filePath,
    );
    if (existing) {
      // Save last selected scope
      await settingsStore.setLastSelectedScope(normalizedTarget);
      sessionsStore.setActiveSession(existing.sessionId);
      await ensureRuntime(existing);
      await sessionAttentionStore
        .markSeen(getAttentionSubjectForHistory(history))
        .catch(() => undefined);
      requestAnimationFrame(() => scrollToBottom(false, true));
      return;
    }

    // Save last selected scope
    await settingsStore.setLastSelectedScope(normalizedTarget);

    await createSession(projectDir, history.filePath);
    await sessionAttentionStore
      .markSeen(getAttentionSubjectForHistory(history))
      .catch(() => undefined);
  }

  async function onRemoveHistory(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const normalizedProjectDir = normalizeScopePath(projectDir);
    const normalizedFilePath = history.filePath.trim();
    const normalizedSessionId = history.sessionId.trim();
    const attentionSubject = getAttentionSubjectForHistory(history);

    const openSession = sessionsStore.sessions.find(
      (session) => session.sessionFile?.trim() === normalizedFilePath,
    );

    if (openSession) {
      try {
        await closeSessionWithTabBehavior(openSession.sessionId);
      } catch {
        // Ignore close errors - session may already be closed in backend
      }
    }

    await projectScopesStore.deleteSession(
      normalizedProjectDir,
      normalizedSessionId,
      normalizedFilePath,
      getProjectScopeSeedScopes(),
    );
    await sessionAttentionStore
      .removeSubject(attentionSubject)
      .catch(() => undefined);

    await recoverSessionSelectionAfterScopeMutation();
  }

  async function onRemoveScope(projectDir: string): Promise<void> {
    // Normalize project dir for comparison (remove trailing slashes)
    const normalizedProjectDir = projectDir.replace(/[\\/]+$/, "");
    const scopeHistory = scopeHistoryByProject[normalizedProjectDir] ?? [];

    // Close all sessions for this scope via backend
    const sessionsToClose = sessionsStore.sessions.filter(
      (session) =>
        session.projectDir.replace(/[\\/]+$/, "") === normalizedProjectDir,
    );
    for (const session of sessionsToClose) {
      try {
        await closeSessionWithTabBehavior(session.sessionId);
      } catch {
        // Ignore close errors - session may not exist in backend
      }
    }

    // Delete the scope (session files) via backend
    await projectScopesStore.deleteScope(
      normalizedProjectDir,
      getProjectScopeSeedScopes(),
    );

    if (
      normalizeScopePath(settingsStore.lastSelectedScope) ===
      normalizedProjectDir
    ) {
      await settingsStore.setLastSelectedScope("");
    }
    await Promise.allSettled(
      scopeHistory.map((history) =>
        sessionAttentionStore.removeSubject(
          getAttentionSubjectForHistory(history),
        ),
      ),
    );

    await recoverSessionSelectionAfterScopeMutation();
  }

  function handleAgentError(errorPayload: string): void {
    for (const runtime of Object.values(sessionRuntimes)) {
      runtime.messages.addErrorMessage(errorPayload);
      runtime.agent.setLoading(false);
      runtime.messages.setStreamingMessageId(null);
    }
  }

  function handleAgentTerminated(exitCode: number | null): void {
    console.log("Agent terminated with code:", exitCode);
    for (const runtime of Object.values(sessionRuntimes)) {
      runtime.agent.setLoading(false);
      runtime.messages.setStreamingMessageId(null);
    }
  }

  function onPromptInput(value: string): void {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }

    promptDraftBySession = {
      ...promptDraftBySession,
      [sessionId]: value,
    };
  }

  function onPromptAttachmentsChange(images: PromptImageAttachment[]): void {
    const sessionId = activeSessionId;
    if (!sessionId) {
      return;
    }

    promptAttachmentDraftBySession = {
      ...promptAttachmentDraftBySession,
      [sessionId]: images,
    };
  }

  async function onSubmit(
    prompt: string,
    images?: PromptImageAttachment[],
  ): Promise<void> {
    if (!activeRuntime) return;

    const bangCommand = parseBangCommand(prompt);
    if (bangCommand) {
      if ((images?.length ?? 0) > 0) {
        activeRuntime.messages.addErrorMessage(
          "Image attachments are not supported for !/!! bash commands.",
        );
        return;
      }

      try {
        await activeRuntime.agent.sendBashCommand(
          bangCommand.command,
          bangCommand.excludeFromContext,
        );
        await loadMessages(activeRuntime);
      } catch (error) {
        activeRuntime.messages.clearStreamingBashExecution();
        activeRuntime.messages.addErrorMessage(
          error instanceof Error ? error.message : String(error),
        );
      }
      return;
    }

    maybeTrackOptimisticFirstPrompt(activeRuntime, prompt);
    const submitPromise = handlePromptSubmit(activeRuntime, prompt, images);
    requestAnimationFrame(() => scrollToBottom(false, true));
    await submitPromise;
  }

  function onCancel(): void {
    if (activeRuntime?.agent.isBashRunning) {
      void activeRuntime.agent.abortBash();
      return;
    }

    activeRuntime?.agent.abort();
  }

  async function onNewChat(): Promise<void> {
    if (!activeRuntime || !chatHasMessages) {
      return;
    }

    if (activeRuntime.agent.isBashRunning) {
      activeRuntime.messages.addErrorMessage(
        "Abort the running bash command before starting a new chat.",
      );
      return;
    }

    const projectDir = normalizeScopePath(activeRuntime.projectDir);
    if (projectDir.length === 0) {
      return;
    }

    await settingsStore.setLastSelectedScope(projectDir);

    if (isFloatingSessionWindow) {
      await createSiblingFloatingSessionWindow(projectDir);
      return;
    }

    await createSession(projectDir);
  }

  async function onModelChange(
    provider: string,
    modelId: string,
  ): Promise<void> {
    if (!activeRuntime) return;

    try {
      await activeRuntime.agent.setModel(provider, modelId);
    } catch (error) {
      activeRuntime.messages.addErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function onThinkingChange(level: ThinkingLevel): Promise<void> {
    if (!activeRuntime) return;

    try {
      await activeRuntime.agent.setThinkingLevel(level);
    } catch (error) {
      activeRuntime.messages.addErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function onModelFilterChange(mode: "all" | "enabled"): Promise<void> {
    await settingsStore.setModelFilter(mode);
  }

  async function onThemeChange(theme: UiTheme): Promise<void> {
    await settingsStore.setTheme(theme);
    await broadcastUiTheme(theme);
  }

  async function onToolResultsCollapsedChange(
    collapsed: boolean,
  ): Promise<void> {
    await settingsStore.setToolResultsCollapsedByDefault(collapsed);
  }

  async function onThinkingCollapsedChange(collapsed: boolean): Promise<void> {
    await settingsStore.setThinkingCollapsedByDefault(collapsed);
  }

  async function onSlashCommand(
    command: string,
    args: string,
    fullText: string,
  ): Promise<void> {
    if (!activeRuntime) return;

    if (command === "new") {
      await onNewChat();
      return;
    }

    const result = await handleSlashCommand(
      activeRuntime,
      command,
      args,
      fullText,
      activeRuntime.agent.availableSlashCommands,
    );

    switch (result.type) {
      case "error":
        activeRuntime.messages.addErrorMessage(result.message);
        break;
      case "submit": {
        maybeTrackOptimisticFirstPrompt(activeRuntime, result.text);
        const submitPromise = handlePromptSubmit(activeRuntime, result.text);
        requestAnimationFrame(() => scrollToBottom(false, true));
        await submitPromise;
        break;
      }
      case "handled":
        break;
    }
  }

  async function onToggleScopeCollapse(scope: string): Promise<void> {
    await settingsStore.toggleScopeCollapsed(scope);
  }

  $effect(() => {
    const active = sessionsStore.activeSession;
    if (active) {
      projectDirInput = active.projectDir;
    }
  });

  $effect(() => {
    const validSessionIds = new Set(
      sessionsStore.sessions.map((session) => session.sessionId),
    );

    const promptEntries = Object.entries(promptDraftBySession).filter(
      ([sessionId]) => validSessionIds.has(sessionId),
    );
    if (promptEntries.length !== Object.keys(promptDraftBySession).length) {
      promptDraftBySession = Object.fromEntries(promptEntries);
    }

    const attachmentEntries = Object.entries(
      promptAttachmentDraftBySession,
    ).filter(([sessionId]) => validSessionIds.has(sessionId));
    if (
      attachmentEntries.length !==
      Object.keys(promptAttachmentDraftBySession).length
    ) {
      promptAttachmentDraftBySession = Object.fromEntries(attachmentEntries);
    }
  });

  $effect(() => {
    if (!isMainWindow) {
      return;
    }

    void refreshDetachedSessionIds().catch(() => undefined);
  });

  $effect(() => {
    if (!sessionsBootstrapped || !isFloatingSessionWindow || !boundSessionId) {
      return;
    }

    const hasBoundSession = sessionsStore.sessions.some(
      (session) => session.sessionId === boundSessionId,
    );

    if (!hasBoundSession && !sessionsStore.creating) {
      floatingSessionMissing = true;
    }
  });

  onMount(async () => {
    const settingsLoad = settingsStore.load().catch((error) => {
      console.warn("Failed to load settings:", error);
    });
    const sessionAttentionLoad = sessionAttentionStore.load().catch((error) => {
      console.warn("Failed to load session attention state:", error);
    });

    await settingsLoad;

    try {
      await Promise.race([
        bootstrapSessions({
          isFloatingSessionWindow,
          boundSessionId,
          requestedSessionId: windowContext.sessionId,
          requestedSessionFile: windowContext.sessionFile,
          refreshProjectScopes: async () =>
            projectScopesStore.refresh(getProjectScopeSeedScopes()),
          refreshSessions: async () => sessionsStore.refreshFromBackend(),
          getSessions: () => sessionsStore.sessions,
          getActiveSession: () => sessionsStore.activeSession,
          setActiveSession: (sessionId) =>
            sessionsStore.setActiveSession(sessionId),
          ensureRuntime: async (descriptor) => {
            await ensureRuntime(descriptor);
          },
          createSession: async (projectDir, sessionFile, options) => {
            return await createSession(projectDir, sessionFile, options);
          },
          isProjectDirValid,
          getLastSelectedScope: () => settingsStore.lastSelectedScope,
          getRestorableOpenSessionTabs: () => settingsStore.openSessionTabs,
          getRestorableOpenSessionActiveIndex: () =>
            settingsStore.activeOpenSessionTabIndex,
          getScopeHistory: (scope) => projectScopesStore.historyByScope[scope],
          setProjectDirInput: (value) => {
            projectDirInput = value;
          },
          requestScrollToBottom: () => {
            requestAnimationFrame(() => scrollToBottom(false, true));
          },
          setFloatingSessionMissing: (missing) => {
            floatingSessionMissing = missing;
          },
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Session bootstrap timed out"));
          }, 20_000);
        }),
      ]);
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
    } finally {
      sessionsBootstrapped = true;
    }

    await Promise.allSettled([sessionAttentionLoad]);

    disposeWindowFocusChanged = await getCurrentWindow()
      .onFocusChanged((event) => {
        isWindowFocused = event.payload;

        if (!event.payload) {
          return;
        }

        void settingsStore.load().catch(() => undefined);
        void markVisibleSessionSeen().catch(() => undefined);
        void refreshDetachedSessionIds().catch(() => undefined);
      })
      .catch(() => null);

    if (isMainWindow) {
      detachedSessionRefreshTimer = setInterval(() => {
        void refreshDetachedSessionIds().catch(() => undefined);
      }, 1500);
    }

    disposeAgentEventBridge = await setupAgentEventBridge({
      getRuntime: (sessionId) => sessionRuntimes[sessionId],
      getActiveSessionId: () => sessionsStore.activeSessionId,
      handleRuntimeEvent: (runtime, event) => {
        handleAgentEvent(runtime, event);

        if (event.type !== "agent_end") {
          return;
        }

        if (!isMainWindow) {
          if (
            isSessionVisibleInCurrentWindow({
              runtime,
              activeSessionId: sessionsStore.activeSessionId,
              isWindowFocused,
              isFloatingSessionWindow,
              boundSessionId,
            })
          ) {
            void sessionAttentionStore
              .markSeen(getAttentionSubjectForRuntime(runtime))
              .catch(() => undefined);
          }
          return;
        }

        const attentionSubject = getAttentionSubjectForRuntime(runtime);
        if (!attentionSubject) {
          return;
        }

        void (async () => {
          const visibleSomewhere = await isSessionVisibleInAnyFocusedWindow(
            runtime.sessionId,
          );

          if (visibleSomewhere) {
            await sessionAttentionStore.markSeen(attentionSubject);
            return;
          }

          await sessionAttentionStore.markCompleted(attentionSubject);
        })().catch(() => undefined);
      },
      markSessionSidebarSyncPending: (sessionId) => {
        pendingSessionSidebarSync.add(sessionId);
      },
      isSessionSidebarSyncPending: (sessionId) => {
        return pendingSessionSidebarSync.has(sessionId);
      },
      scheduleSessionSidebarRefresh,
      scheduleScrollToBottom,
      handleAgentError,
      handleAgentTerminated,
    });
  });

  onDestroy(() => {
    disposeAgentEventBridge?.();
    disposeWindowFocusChanged?.();

    if (sessionSidebarRefreshTimer) {
      clearTimeout(sessionSidebarRefreshTimer);
      sessionSidebarRefreshTimer = null;
    }

    if (detachedSessionRefreshTimer) {
      clearInterval(detachedSessionRefreshTimer);
      detachedSessionRefreshTimer = null;
    }

    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }

    if (resizeScrollRaf !== null) {
      cancelAnimationFrame(resizeScrollRaf);
      resizeScrollRaf = null;
    }

    pendingSessionSidebarSync.clear();
    optimisticFirstPromptBySession = {};
    promptDraftBySession = {};
    promptAttachmentDraftBySession = {};
    detachedSessionIds = [];
  });
</script>

<MainChatLayout
  {projectScopes}
  {scopeHistoryByProject}
  {activeProjectDir}
  {activeSessionId}
  {activeSessionFile}
  {busySessionIds}
  {busySessionFiles}
  {reviewSessionIds}
  {reviewSessionFiles}
  sessionsCreating={sessionsStore.creating}
  {sidebarCollapsed}
  collapsedScopes={settingsStore.collapsedScopes}
  {activeSession}
  {startupError}
  emptyStateText={layoutEmptyStateText}
  {activeRuntime}
  {messages}
  {activePromptDraft}
  {activePromptAttachmentDraft}
  {isLoading}
  {sessionStarted}
  {currentModel}
  {currentProvider}
  {currentThinkingLevel}
  {currentModelSupportsImageInput}
  {supportsThinking}
  {availableThinkingLevels}
  {availableModels}
  {isModelsLoading}
  {isSettingModel}
  {isSettingThinking}
  modelFilter={settingsStore.modelFilter}
  theme={settingsStore.theme}
  toolResultsCollapsedByDefault={settingsStore.toolResultsCollapsedByDefault}
  thinkingCollapsedByDefault={settingsStore.thinkingCollapsedByDefault}
  {chatHasMessages}
  {usageIndicator}
  {slashCommands}
  {runtimeSlashCommands}
  {isExtensionsLoading}
  {extensionsLoadError}
  {globalExtensions}
  {localExtensions}
  {extensionLoadDiagnostics}
  sessionTabs={orderedSessionTabs}
  showSidebar={showSidebarInLayout}
  showSettingsButton={true}
  showHeader={showHeaderInLayout}
  windowTitleHint={layoutWindowTitleHint}
  onmessagescroll={handleScroll}
  onmessagescontainerchange={(element) => {
    messagesContainerRef = element;
  }}
  onmessagescontentchange={(element) => {
    messagesContentRef = element;
  }}
  onselectsessiontab={onSelectSessionTab}
  onclosesessiontab={onCloseSessionTab}
  ontogglesidebar={toggleSidebar}
  oncreateprojectscope={createProjectScope}
  onselectscope={onSelectScope}
  onselecthistory={onSelectHistory}
  onopenhistorywindow={onOpenHistoryInFloatingWindow}
  onremovehistory={onRemoveHistory}
  onremovescope={onRemoveScope}
  ontogglescopecollapse={onToggleScopeCollapse}
  onpopoutactivesession={showPopOutActiveSessionButton
    ? onPopOutActiveSession
    : undefined}
  onpromptinput={onPromptInput}
  onpromptattachmentschange={onPromptAttachmentsChange}
  onsubmit={onSubmit}
  oncancel={onCancel}
  onslashcommand={onSlashCommand}
  onnewchat={onNewChat}
  onmodelchange={onModelChange}
  onthinkingchange={onThinkingChange}
  onmodelfilterchange={onModelFilterChange}
  onthemechange={onThemeChange}
  ontoolresultscollapsedchange={onToolResultsCollapsedChange}
  onthinkingcollapsedchange={onThinkingCollapsedChange}
/>
