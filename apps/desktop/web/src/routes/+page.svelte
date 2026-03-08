<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getAllWindows, getCurrentWindow } from "@tauri-apps/api/window";

  import MainChatLayout from "$lib/components/layout/MainChatLayout.svelte";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import { setupAgentEventBridge } from "$lib/handlers/agent-event-bridge";
  import {
    handlePromptSubmit,
    handleSlashCommand,
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
    removeRuntimeForSession,
    type SessionRuntimeMap,
  } from "$lib/session/runtime-manager";
  import type { ThinkingLevel } from "$lib/stores/agent.svelte";
  import { cwdStore } from "$lib/stores/cwd.svelte";
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
  import { settingsStore } from "$lib/stores/settings.svelte";
  import { broadcastUiTheme, type UiTheme } from "$lib/theme/app-theme";
  import type { PromptImageAttachment } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";
  import {
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

    return "Create a session to start chatting.";
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

  function scrollToBottom(smooth = true): void {
    activeRuntime?.messages.scrollToBottom(messagesContainerRef, smooth);
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

  async function getWorkingDirectoryFallback(): Promise<string> {
    return cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
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
      createSession: async (projectDir) => createSession(projectDir),
      getWorkingDirectoryFallback,
      requestScrollToBottom: () => {
        requestAnimationFrame(() => scrollToBottom(false));
      },
    });
  }

  async function createSession(
    projectDir: string,
    sessionFile?: string,
  ): Promise<void> {
    const descriptor = await sessionsStore.createSession(
      projectDir,
      undefined,
      undefined,
      sessionFile,
    );
    await ensureRuntime(descriptor);
    projectDirInput = "";
    scheduleSessionSidebarRefresh(250);
    requestAnimationFrame(() => scrollToBottom(false));
  }

  async function createSessionFromInput(): Promise<void> {
    const value = projectDirInput.trim();
    const fallback = await getWorkingDirectoryFallback();
    const projectDir = value.length > 0 ? value : fallback;
    await createSession(projectDir);
  }

  async function popOutSession(descriptor: SessionDescriptor): Promise<void> {
    await openOrFocusFloatingSessionWindow({
      sessionId: descriptor.sessionId,
      projectDir: descriptor.projectDir,
      sessionFile: descriptor.sessionFile,
    });
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

  function onProjectDirInputChange(value: string): void {
    projectDirInput = value;
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
      requestAnimationFrame(() => scrollToBottom(false));
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
        await sessionsStore.closeSession(openSession.sessionId);
      } catch {
        // Ignore close errors - session may already be closed in backend
      }

      sessionRuntimes = removeRuntimeForSession(
        sessionRuntimes,
        openSession.sessionId,
      );
      pendingSessionSidebarSync.delete(openSession.sessionId);
      clearOptimisticFirstPrompt(openSession.sessionId);
    }

    await projectScopesStore.deleteSession(
      normalizedProjectDir,
      normalizedSessionId,
      normalizedFilePath,
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
        await sessionsStore.closeSession(session.sessionId);
      } catch {
        // Ignore close errors - session may not exist in backend
      }
      // Clean up runtime state
      sessionRuntimes = removeRuntimeForSession(
        sessionRuntimes,
        session.sessionId,
      );
      pendingSessionSidebarSync.delete(session.sessionId);
      clearOptimisticFirstPrompt(session.sessionId);
    }

    // Delete the scope (session files) via backend
    await projectScopesStore.deleteScope(normalizedProjectDir);
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
    maybeTrackOptimisticFirstPrompt(activeRuntime, prompt);
    await handlePromptSubmit(activeRuntime, prompt, images);
  }

  function onCancel(): void {
    activeRuntime?.agent.abort();
  }

  async function onNewChat(): Promise<void> {
    if (!activeRuntime || !chatHasMessages) {
      return;
    }

    if (activeRuntime.agent.isLoading) {
      if (isFloatingSessionWindow) {
        await createSiblingFloatingSessionWindow(activeRuntime.projectDir);
        return;
      }

      await createSession(activeRuntime.projectDir);
      return;
    }

    await onSlashCommand("new", "", "/new");
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
      if (activeRuntime.agent.isLoading) {
        clearOptimisticFirstPrompt(activeRuntime.sessionId);

        if (isFloatingSessionWindow) {
          await createSiblingFloatingSessionWindow(activeRuntime.projectDir);
          return;
        }

        await createSession(activeRuntime.projectDir);
        return;
      }
    }

    const result = await handleSlashCommand(
      activeRuntime,
      command,
      args,
      fullText,
    );

    switch (result.type) {
      case "error":
        activeRuntime.messages.addErrorMessage(result.message);
        break;
      case "submit":
        maybeTrackOptimisticFirstPrompt(activeRuntime, result.text);
        await handlePromptSubmit(activeRuntime, result.text);
        break;
      case "handled":
        if (command === "new") {
          clearOptimisticFirstPrompt(activeRuntime.sessionId);
          await sessionsStore.refreshFromBackend().catch(() => undefined);
        }
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
    // Never block startup on settings/plugin-store load.
    // If store access stalls, keep bootstrapping sessions with defaults.
    const settingsLoad = settingsStore.load().catch((error) => {
      console.warn("Failed to load settings:", error);
    });
    const sessionAttentionLoad = sessionAttentionStore.load().catch((error) => {
      console.warn("Failed to load session attention state:", error);
    });

    void settingsLoad;
    void sessionAttentionLoad;

    try {
      await Promise.race([
        bootstrapSessions({
          isFloatingSessionWindow,
          boundSessionId,
          requestedSessionId: windowContext.sessionId,
          requestedSessionFile: windowContext.sessionFile,
          loadCwd: async () => cwdStore.load(),
          refreshProjectScopes: async () => projectScopesStore.refresh(),
          refreshSessions: async () => sessionsStore.refreshFromBackend(),
          getSessions: () => sessionsStore.sessions,
          getActiveSession: () => sessionsStore.activeSession,
          setActiveSession: (sessionId) =>
            sessionsStore.setActiveSession(sessionId),
          ensureRuntime: async (descriptor) => {
            await ensureRuntime(descriptor);
          },
          createSession: async (projectDir, sessionFile) => {
            await createSession(projectDir, sessionFile);
          },
          getWorkingDirectory: async () => getWorkingDirectoryFallback(),
          getLastSelectedScope: () => settingsStore.lastSelectedScope,
          getScopeHistory: (scope) => projectScopesStore.historyByScope[scope],
          setProjectDirInput: (value) => {
            projectDirInput = value;
          },
          requestScrollToBottom: () => {
            requestAnimationFrame(() => scrollToBottom(false));
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

    await Promise.allSettled([settingsLoad, sessionAttentionLoad]);

    disposeWindowFocusChanged = await getCurrentWindow()
      .onFocusChanged((event) => {
        isWindowFocused = event.payload;

        if (!event.payload) {
          return;
        }

        void settingsStore.load().catch(() => undefined);
        void markVisibleSessionSeen().catch(() => undefined);
      })
      .catch(() => null);

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
  {projectDirInput}
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
  {isExtensionsLoading}
  {extensionsLoadError}
  {globalExtensions}
  {localExtensions}
  {extensionLoadDiagnostics}
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
  ontogglesidebar={toggleSidebar}
  onprojectdirinput={onProjectDirInputChange}
  oncreatesession={createSessionFromInput}
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
