<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  import CompactChatLayout from "$lib/components/layout/CompactChatLayout.svelte";
  import MainChatLayout from "$lib/components/layout/MainChatLayout.svelte";
  import {
    buildCompactActivityItems,
    type CompactActivityItem,
  } from "$lib/components/layout/compact-activity";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import { setupAgentEventBridge } from "$lib/handlers/agent-event-bridge";
  import {
    handlePromptSubmit,
    handleSlashCommand,
  } from "$lib/handlers/commands";
  import { bootstrapSessions } from "$lib/session/bootstrap";
  import { recoverSessionSelectionAfterMutation } from "$lib/session/post-mutation-recovery";
  import {
    hasPersistedSessionHistory,
    mergeScopeHistory,
    toScopeTitle,
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
  import { settingsStore } from "$lib/stores/settings.svelte";
  import type { PromptImageAttachment } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";
  import { applyWindowMode, type DisplayMode } from "$lib/utils/window-mode";
  import {
    openOrFocusCompactSessionWindow,
    openOrFocusMainWindow,
  } from "$lib/windowing/session-windows";
  import { getCurrentWindowContext } from "$lib/windowing/window-context";

  // DOM refs
  let messagesContainerRef = $state<HTMLDivElement | null>(null);

  // Event unlistener
  let disposeAgentEventBridge: (() => void) | null = null;

  let sessionRuntimes = $state<SessionRuntimeMap>({});
  let projectDirInput = $state("");
  let startupError = $state<string | null>(null);
  let sessionsBootstrapped = $state(false);
  let sidebarCollapsed = $state(false);
  let compactScopesSidebarOpen = $state(false);
  let sessionSidebarRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingSessionSidebarSync = new Set<string>();
  let optimisticFirstPromptBySession = $state<
    Record<string, { text: string; timestamp: string }>
  >({});
  let promptDraftBySession = $state<Record<string, string>>({});
  let promptAttachmentDraftBySession = $state<
    Record<string, PromptImageAttachment[]>
  >({});
  let compactSessionMissing = $state(false);
  const windowContext = getCurrentWindowContext();
  const isCompactSessionWindow = windowContext.role === "compact-session";
  const boundSessionId = windowContext.sessionId;
  const EMPTY_PROMPT_ATTACHMENTS: PromptImageAttachment[] = [];

  // Ensure compact transparency CSS applies as early as possible on compact
  // pop-out windows to avoid first-paint background flashes.
  if (typeof document !== "undefined" && isCompactSessionWindow) {
    document.documentElement.setAttribute("data-display-mode", "compact");
  }

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
  const isStreaming = $derived(
    activeRuntime ? activeRuntime.messages.streamingMessageId !== null : false,
  );
  const chatHasMessages = $derived(messages.length > 0);
  const usageIndicator = $derived(
    activeRuntime ? activeRuntime.agent.usageIndicator : null,
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
  const compactUsageTooltipLine = $derived.by(() => {
    const contextText = usageIndicator?.contextText?.trim() ?? "";
    if (contextText.length === 0) {
      return "Usage: unavailable";
    }

    const usageText = contextText.split(/\s+/)[0] ?? contextText;
    return `Usage: ${usageText}`;
  });

  const compactModelTooltipLine = $derived.by(() => {
    const provider = currentProvider.trim();
    const model = currentModel.trim();

    if (provider && model) {
      return `Model: ${provider}/${model}`;
    }

    return `Model: ${model || "No model selected"}`;
  });

  const compactScopeTooltip = $derived.by(() => {
    const scopeLine = activeProjectDir
      ? `Project Scope: ${toScopeTitle(activeProjectDir)}`
      : "Project Scope: none";

    return [compactUsageTooltipLine, compactModelTooltipLine, scopeLine].join(
      "\n",
    );
  });
  const displayMode = $derived.by((): DisplayMode => {
    if (isCompactSessionWindow) {
      return "compact";
    }

    return settingsStore.displayMode;
  });
  const isCompactMode = $derived(displayMode === "compact");

  const compactActivityItems = $derived.by((): CompactActivityItem[] => {
    if (!activeRuntime || messages.length === 0) {
      return [];
    }

    return buildCompactActivityItems(messages);
  });

  let hideCompactRail = $state(false);
  let lastCompactRailSessionId = $state<string | null>(null);

  $effect(() => {
    const currentSessionId = activeSessionId;

    if (currentSessionId !== lastCompactRailSessionId) {
      hideCompactRail = false;
      lastCompactRailSessionId = currentSessionId;
    }
  });

  const showCompactActivityRail = $derived.by(() => {
    if (
      hideCompactRail ||
      !isCompactMode ||
      compactActivityItems.length === 0
    ) {
      return false;
    }

    return true;
  });

  const showCompactActivityRailShell = $derived(
    !hideCompactRail && isCompactMode && sessionStarted,
  );

  const compactRailViewportClass = $derived.by(() => {
    if (!showCompactActivityRail) {
      return "";
    }

    const hasAssistantCard = compactActivityItems.some(
      (item) => item.type === "assistant",
    );

    return hasAssistantCard ? "h-[18rem]" : "h-[5.75rem]";
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

  function scheduleScrollToBottom(): void {
    if (scrollRaf === null) {
      scrollRaf = requestAnimationFrame(() => {
        scrollToBottom(false);
        scrollRaf = null;
      });
    }
  }

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
      setActiveSession: (sessionId) => sessionsStore.setActiveSession(sessionId),
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
    await openOrFocusCompactSessionWindow({
      sessionId: descriptor.sessionId,
      projectDir: descriptor.projectDir,
      sessionFile: descriptor.sessionFile,
    });
  }

  async function onOpenHistoryInCompactWindow(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const previousActiveSessionId = sessionsStore.activeSessionId;

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
      ));

    if (!existing && previousActiveSessionId) {
      sessionsStore.setActiveSession(previousActiveSessionId);
    }

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

  async function createSiblingCompactSessionWindow(
    projectDir: string,
  ): Promise<void> {
    const previousActiveSessionId = activeRuntime?.sessionId ?? null;
    const descriptor = await sessionsStore.createSession(projectDir);

    scheduleSessionSidebarRefresh(250);
    await popOutSession(descriptor);

    if (previousActiveSessionId) {
      sessionsStore.setActiveSession(previousActiveSessionId);
    }
  }

  async function closeCurrentWindow(): Promise<void> {
    await getCurrentWindow()
      .close()
      .catch(() => undefined);
  }

  function toggleSidebar(): void {
    sidebarCollapsed = !sidebarCollapsed;
  }

  function toggleCompactScopesSidebar(): void {
    compactScopesSidebarOpen = !compactScopesSidebarOpen;
  }

  async function setDisplayMode(mode: DisplayMode): Promise<void> {
    if (isCompactSessionWindow) {
      await applyWindowMode("compact").catch(() => undefined);
      return;
    }

    if (settingsStore.displayMode === mode) {
      return;
    }

    const previousMode = settingsStore.displayMode;

    try {
      await applyWindowMode(mode);
      await settingsStore.setDisplayMode(mode);
    } catch (error) {
      console.error("Failed to switch display mode:", error);

      // Best effort rollback for window visuals if apply partially succeeded.
      try {
        await applyWindowMode(previousMode);
      } catch {
        // ignore rollback errors
      }
    }
  }

  async function enterCompactMode(): Promise<void> {
    await setDisplayMode("compact");
  }

  async function enterFullMode(): Promise<void> {
    if (isCompactSessionWindow) {
      await openOrFocusMainWindow();
      return;
    }

    compactScopesSidebarOpen = false;
    await setDisplayMode("full");

    await tick();
    requestAnimationFrame(() => scrollToBottom(false));
  }

  async function onCompactDragHandleMouseDown(
    event: MouseEvent,
  ): Promise<void> {
    if (event.button !== 0) {
      return;
    }

    await getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }

  async function onCompactResizeHandleMouseDown(
    event: MouseEvent,
    direction: "West" | "East",
  ): Promise<void> {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    await getCurrentWindow()
      .startResizeDragging(direction)
      .catch(() => undefined);
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
      compactScopesSidebarOpen = false;
      return;
    }

    // Save last selected scope
    await settingsStore.setLastSelectedScope(normalizedTarget);

    await createSession(projectDir);
    compactScopesSidebarOpen = false;
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
      requestAnimationFrame(() => scrollToBottom(false));
      compactScopesSidebarOpen = false;
      return;
    }

    // Save last selected scope
    await settingsStore.setLastSelectedScope(normalizedTarget);

    await createSession(projectDir, history.filePath);
    compactScopesSidebarOpen = false;
  }

  async function onRemoveHistory(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const normalizedProjectDir = normalizeScopePath(projectDir);
    const normalizedFilePath = history.filePath.trim();
    const normalizedSessionId = history.sessionId.trim();

    const openSession = sessionsStore.sessions.find(
      (session) => session.sessionFile?.trim() === normalizedFilePath,
    );

    if (openSession) {
      try {
        await sessionsStore.closeSession(openSession.sessionId);
      } catch {
        // Ignore close errors - session may already be closed in backend
      }

      sessionRuntimes = removeRuntimeForSession(sessionRuntimes, openSession.sessionId);
      pendingSessionSidebarSync.delete(openSession.sessionId);
      clearOptimisticFirstPrompt(openSession.sessionId);
    }

    await projectScopesStore.deleteSession(
      normalizedProjectDir,
      normalizedSessionId,
      normalizedFilePath,
    );

    await recoverSessionSelectionAfterScopeMutation();
  }

  async function onRemoveScope(projectDir: string): Promise<void> {
    // Normalize project dir for comparison (remove trailing slashes)
    const normalizedProjectDir = projectDir.replace(/[\\/]+$/, "");

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
      sessionRuntimes = removeRuntimeForSession(sessionRuntimes, session.sessionId);
      pendingSessionSidebarSync.delete(session.sessionId);
      clearOptimisticFirstPrompt(session.sessionId);
    }

    // Delete the scope (session files) via backend
    await projectScopesStore.deleteScope(normalizedProjectDir);

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
    hideCompactRail = false;
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

    hideCompactRail = true;

    if (activeRuntime.agent.isLoading) {
      if (isCompactSessionWindow) {
        await createSiblingCompactSessionWindow(activeRuntime.projectDir);
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

  async function onSlashCommand(
    command: string,
    args: string,
    fullText: string,
  ): Promise<void> {
    if (!activeRuntime) return;

    if (command === "new") {
      hideCompactRail = true;

      if (activeRuntime.agent.isLoading) {
        clearOptimisticFirstPrompt(activeRuntime.sessionId);

        if (isCompactSessionWindow) {
          await createSiblingCompactSessionWindow(activeRuntime.projectDir);
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
        hideCompactRail = false;
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
    if (!sessionsBootstrapped || !isCompactSessionWindow || !boundSessionId) {
      return;
    }

    const hasBoundSession = sessionsStore.sessions.some(
      (session) => session.sessionId === boundSessionId,
    );

    if (!hasBoundSession && !sessionsStore.creating) {
      compactSessionMissing = true;
    }
  });

  $effect(() => {
    document.documentElement.setAttribute("data-display-mode", displayMode);
  });

  $effect(() => {
    if (!isCompactMode && compactScopesSidebarOpen) {
      compactScopesSidebarOpen = false;
    }
  });

  onMount(async () => {
    // Never block startup on settings/plugin-store load.
    // If store access stalls, keep bootstrapping sessions with defaults.
    const settingsLoad = settingsStore
      .load()
      .catch((error) => {
        console.warn("Failed to load settings:", error);
      })
      .then(() => {
        // Do not block session/bootstrap initialization on window-manager APIs.
        // On some Linux setups, mode application can stall temporarily.
        const initialMode: DisplayMode = isCompactSessionWindow
          ? "compact"
          : settingsStore.displayMode;

        return applyWindowMode(initialMode).catch((error) => {
          console.warn("Failed to apply initial window mode:", error);
        });
      });

    void settingsLoad;

    try {
      await Promise.race([
        bootstrapSessions({
          isCompactSessionWindow,
          boundSessionId,
          requestedSessionFile: windowContext.sessionFile,
          loadCwd: async () => cwdStore.load(),
          refreshProjectScopes: async () => projectScopesStore.refresh(),
          refreshSessions: async () => sessionsStore.refreshFromBackend(),
          getSessions: () => sessionsStore.sessions,
          getActiveSession: () => sessionsStore.activeSession,
          setActiveSession: (sessionId) => sessionsStore.setActiveSession(sessionId),
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
          setCompactSessionMissing: (missing) => {
            compactSessionMissing = missing;
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

    disposeAgentEventBridge = await setupAgentEventBridge({
      getRuntime: (sessionId) => sessionRuntimes[sessionId],
      getActiveSessionId: () => sessionsStore.activeSessionId,
      handleRuntimeEvent: (runtime, event) => {
        handleAgentEvent(runtime, event);
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

    if (sessionSidebarRefreshTimer) {
      clearTimeout(sessionSidebarRefreshTimer);
      sessionSidebarRefreshTimer = null;
    }

    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }

    pendingSessionSidebarSync.clear();
    optimisticFirstPromptBySession = {};
    promptDraftBySession = {};
    promptAttachmentDraftBySession = {};
  });
</script>

{#if isCompactMode}
  <CompactChatLayout
    {isCompactSessionWindow}
    {sessionsBootstrapped}
    {compactSessionMissing}
    {projectScopes}
    {scopeHistoryByProject}
    {activeProjectDir}
    {activeSessionId}
    {activeSessionFile}
    {busySessionIds}
    {busySessionFiles}
    {projectDirInput}
    sessionsCreating={sessionsStore.creating}
    collapsedScopes={settingsStore.collapsedScopes}
    {compactScopesSidebarOpen}
    {compactScopeTooltip}
    {showCompactActivityRailShell}
    {showCompactActivityRail}
    {compactRailViewportClass}
    compactActivityItems={compactActivityItems}
    {isStreaming}
    {activeRuntime}
    {sessionStarted}
    {activePromptDraft}
    {activePromptAttachmentDraft}
    {isLoading}
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
    {chatHasMessages}
    onclosewindow={closeCurrentWindow}
    onopenmainwindow={openOrFocusMainWindow}
    ontogglecompactscopes={toggleCompactScopesSidebar}
    onprojectdirinput={onProjectDirInputChange}
    oncreatesession={createSessionFromInput}
    onselectscope={onSelectScope}
    onselecthistory={onSelectHistory}
    onopenhistorywindow={onOpenHistoryInCompactWindow}
    onremovehistory={onRemoveHistory}
    onremovescope={onRemoveScope}
    ontogglescopecollapse={onToggleScopeCollapse}
    oncompactdraghandlemousedown={onCompactDragHandleMouseDown}
    oncompactresizehandlemousedown={onCompactResizeHandleMouseDown}
    onenterfullmode={enterFullMode}
    onpromptinput={onPromptInput}
    onpromptattachmentschange={onPromptAttachmentsChange}
    onsubmit={onSubmit}
    oncancel={onCancel}
    onslashcommand={onSlashCommand}
    onnewchat={onNewChat}
    onmodelchange={onModelChange}
    onthinkingchange={onThinkingChange}
    onmodelfilterchange={onModelFilterChange}
  />
{:else}
  <MainChatLayout
    {projectScopes}
    {scopeHistoryByProject}
    {activeProjectDir}
    {activeSessionId}
    {activeSessionFile}
    {busySessionIds}
    {busySessionFiles}
    {projectDirInput}
    sessionsCreating={sessionsStore.creating}
    {sidebarCollapsed}
    collapsedScopes={settingsStore.collapsedScopes}
    {activeSession}
    {startupError}
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
    {chatHasMessages}
    {usageIndicator}
    onmessagescroll={handleScroll}
    onmessagescontainerchange={(element) => {
      messagesContainerRef = element;
    }}
    ontogglesidebar={toggleSidebar}
    onprojectdirinput={onProjectDirInputChange}
    oncreatesession={createSessionFromInput}
    onselectscope={onSelectScope}
    onselecthistory={onSelectHistory}
    onopenhistorywindow={onOpenHistoryInCompactWindow}
    onremovehistory={onRemoveHistory}
    onremovescope={onRemoveScope}
    ontogglescopecollapse={onToggleScopeCollapse}
    onpopoutactivesession={onPopOutActiveSession}
    onentercompactmode={enterCompactMode}
    onpromptinput={onPromptInput}
    onpromptattachmentschange={onPromptAttachmentsChange}
    onsubmit={onSubmit}
    oncancel={onCancel}
    onslashcommand={onSlashCommand}
    onnewchat={onNewChat}
    onmodelchange={onModelChange}
    onthinkingchange={onThinkingChange}
    onmodelfilterchange={onModelFilterChange}
  />
{/if}
