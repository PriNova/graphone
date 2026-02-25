<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";

  import {
    AssistantMessage,
    CompactActivityRail,
    UserMessage,
  } from "$lib/components/Messages";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { StatusBar } from "$lib/components/StatusBar";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import {
    handlePromptSubmit,
    handleSlashCommand,
  } from "$lib/handlers/commands";
  import {
    createAgentStore,
    type ThinkingLevel,
  } from "$lib/stores/agent.svelte";
  import { cwdStore } from "$lib/stores/cwd.svelte";
  import { createEnabledModelsStore } from "$lib/stores/enabledModels.svelte";
  import { createMessagesStore } from "$lib/stores/messages.svelte";
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
  import type {
    AgentEvent,
    ContentBlock,
    PromptImageAttachment,
    UserContentBlock,
  } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";
  import {
    applyWindowMode,
    syncCompactWindowHeight,
    type DisplayMode,
  } from "$lib/utils/window-mode";

  // DOM refs
  let messagesContainerRef = $state<HTMLDivElement | null>(null);
  let compactLayoutRef = $state<HTMLDivElement | null>(null);

  // Event unlisteners
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;

  let sessionRuntimes = $state<Record<string, SessionRuntime>>({});
  let projectDirInput = $state("");
  let startupError = $state<string | null>(null);
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
  const EMPTY_PROMPT_ATTACHMENTS: PromptImageAttachment[] = [];

  function mergeScopeHistory(
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
        const timestampCmp = (b.timestamp ?? "").localeCompare(
          a.timestamp ?? "",
        );
        if (timestampCmp !== 0) {
          return timestampCmp;
        }
        return a.sessionId.localeCompare(b.sessionId);
      });
    }

    return merged;
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
  const compactScopeTooltip = $derived(
    activeProjectDir
      ? `Project scopes (${toScopeTitle(activeProjectDir)})`
      : "Project scopes",
  );
  const displayMode = $derived(settingsStore.displayMode);
  const isCompactMode = $derived(displayMode === "compact");

  type CompactActivityItem =
    | {
        key: string;
        type: "user";
        block: { summary: string };
      }
    | {
        key: string;
        type: "assistant";
        block: { markdown: string };
      }
    | {
        key: string;
        type: "thinking";
        block: { type: "thinking"; thinking: string };
      }
    | {
        key: string;
        type: "toolCall";
        block: {
          type: "toolCall";
          id: string;
          name: string;
          arguments: Record<string, unknown>;
          result?: string;
          isError?: boolean;
        };
      };

  function summarizeUserPrompt(content: UserContentBlock[]): string {
    const text = content
      .filter(
        (block): block is Extract<UserContentBlock, { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    const imageCount = content.filter((block) => block.type === "image").length;

    let summary = "Prompt sent";
    if (text.length > 0 && imageCount > 0) {
      summary = `${text} • ${imageCount} image${imageCount === 1 ? "" : "s"}`;
    } else if (text.length > 0) {
      summary = text;
    } else if (imageCount > 0) {
      summary = `${imageCount} image${imageCount === 1 ? "" : "s"} attached`;
    }

    return summary.length > 120 ? `${summary.slice(0, 119)}…` : summary;
  }

  function extractAssistantMarkdown(content: ContentBlock[]): string {
    return content
      .filter((block): block is Extract<ContentBlock, { type: "text" }> => {
        return block.type === "text";
      })
      .map((block) => block.text.trim())
      .filter((text) => text.length > 0)
      .join("\n\n")
      .trim();
  }

  const compactActivityItems = $derived.by((): CompactActivityItem[] => {
    if (!activeRuntime || messages.length === 0) {
      return [];
    }

    let lastUserIndex = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.type === "user") {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return [];
    }

    let startIdx = lastUserIndex;
    if (
      lastUserIndex > 0 &&
      messages[lastUserIndex - 1]?.type === "assistant"
    ) {
      startIdx = lastUserIndex - 1;
    }

    const assistantMarkdownByMessageId = new Map<string, string>();
    let latestAssistantMessageIdWithText: string | null = null;

    for (
      let messageIndex = startIdx;
      messageIndex < messages.length;
      messageIndex += 1
    ) {
      const message = messages[messageIndex];
      if (!message || message.type !== "assistant") {
        continue;
      }

      const markdown = extractAssistantMarkdown(message.content);
      if (markdown.length === 0) {
        continue;
      }

      assistantMarkdownByMessageId.set(message.id, markdown);
      latestAssistantMessageIdWithText = message.id;
    }

    const items: CompactActivityItem[] = [];

    for (
      let messageIndex = startIdx;
      messageIndex < messages.length;
      messageIndex += 1
    ) {
      const message = messages[messageIndex];
      if (!message) {
        continue;
      }

      if (message.type === "user") {
        items.push({
          key: `user:${message.id}`,
          type: "user",
          block: { summary: summarizeUserPrompt(message.content) },
        });
        continue;
      }

      for (
        let blockIndex = 0;
        blockIndex < message.content.length;
        blockIndex += 1
      ) {
        const block = message.content[blockIndex];
        if (!block) {
          continue;
        }

        if (block.type === "thinking") {
          items.push({
            key: `thinking:${message.id}:${blockIndex}`,
            type: "thinking",
            block,
          });
          continue;
        }

        if (block.type === "toolCall") {
          const fallbackId = `${message.id}:${blockIndex}`;
          items.push({
            key: `tool:${block.id || fallbackId}`,
            type: "toolCall",
            block,
          });
        }
      }

      if (message.id === latestAssistantMessageIdWithText) {
        const markdown = assistantMarkdownByMessageId.get(message.id);
        if (markdown) {
          items.push({
            key: `assistant:${message.id}`,
            type: "assistant",
            block: { markdown },
          });
        }
      }
    }

    return items.slice(-3);
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
    if (!showCompactActivityRailShell) {
      return "";
    }

    const hasAssistantCard = compactActivityItems.some(
      (item) => item.type === "assistant",
    );

    return hasAssistantCard ? "h-[18rem]" : "h-[5.75rem]";
  });

  let compactHeightRaf: number | null = null;
  let compactLayoutResizeObserver: ResizeObserver | null = null;

  function scheduleCompactHeightSync(): void {
    if (!isCompactMode || compactHeightRaf !== null) {
      return;
    }

    compactHeightRaf = requestAnimationFrame(() => {
      compactHeightRaf = null;

      if (!isCompactMode || !compactLayoutRef) {
        return;
      }

      // offsetHeight tracks layout height only (ignores transform animations),
      // which keeps compact window sizing stable while chips animate in.
      const targetHeight = Math.max(1, compactLayoutRef.offsetHeight);
      void syncCompactWindowHeight(targetHeight).catch(() => undefined);
    });
  }

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

  function hasPersistedSidebarHistory(sessionId: string): boolean {
    const descriptor = sessionsStore.sessions.find(
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
    const history = projectScopesStore.historyByScope[scope] ?? [];

    return history.some((entry) => entry.filePath.trim() === sessionFile);
  }

  function reconcilePendingSessionSidebarSync(): void {
    for (const sessionId of pendingSessionSidebarSync) {
      if (hasPersistedSidebarHistory(sessionId)) {
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

  async function loadMessages(runtime: SessionRuntime): Promise<void> {
    try {
      const response = await invoke<
        | {
            success: true;
            data: {
              messages: Array<{
                role: string;
                content: unknown;
                timestamp?: number;
              }>;
            };
          }
        | { success: false; error: string }
      >("get_messages", { sessionId: runtime.sessionId });

      if (
        response &&
        typeof response === "object" &&
        "success" in response &&
        response.success
      ) {
        runtime.messages.loadFromAgentMessages(response.data.messages);
      }
    } catch (error) {
      runtime.messages.addErrorMessage(`Failed to load messages: ${error}`);
    }
  }

  async function initializeRuntime(
    descriptor: SessionDescriptor,
  ): Promise<SessionRuntime> {
    const runtime: SessionRuntime = {
      sessionId: descriptor.sessionId,
      projectDir: descriptor.projectDir,
      title: descriptor.title,
      agent: createAgentStore(descriptor.sessionId),
      messages: createMessagesStore(),
      enabledModels: createEnabledModelsStore(descriptor.projectDir),
    };

    await runtime.agent.initialize();
    await loadMessages(runtime);
    await runtime.agent.loadAvailableModels().catch((error) => {
      console.warn("Failed to load available models:", error);
    });

    return runtime;
  }

  async function ensureRuntime(
    descriptor: SessionDescriptor,
  ): Promise<SessionRuntime> {
    const existing = sessionRuntimes[descriptor.sessionId];
    if (existing) {
      if (existing.projectDir !== descriptor.projectDir) {
        const updated: SessionRuntime = {
          ...existing,
          projectDir: descriptor.projectDir,
        };
        updated.enabledModels.setProjectDir(descriptor.projectDir);
        await updated.enabledModels.refresh().catch(() => undefined);
        sessionRuntimes = {
          ...sessionRuntimes,
          [descriptor.sessionId]: updated,
        };
        return updated;
      }
      return existing;
    }

    const runtime = await initializeRuntime(descriptor);
    sessionRuntimes = {
      ...sessionRuntimes,
      [descriptor.sessionId]: runtime,
    };
    return runtime;
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
    const fallback =
      cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
    const projectDir = value.length > 0 ? value : fallback;
    await createSession(projectDir);
  }

  function toggleSidebar(): void {
    sidebarCollapsed = !sidebarCollapsed;
  }

  function toggleCompactScopesSidebar(): void {
    compactScopesSidebarOpen = !compactScopesSidebarOpen;
  }

  async function setDisplayMode(mode: DisplayMode): Promise<void> {
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

  function toScopeTitle(projectDir: string | null): string {
    if (!projectDir) {
      return "No active scope";
    }

    const trimmed = projectDir.replace(/[\\/]+$/, "");
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? projectDir;
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

      delete sessionRuntimes[openSession.sessionId];
      pendingSessionSidebarSync.delete(openSession.sessionId);
      clearOptimisticFirstPrompt(openSession.sessionId);
    }

    await projectScopesStore.deleteSession(
      normalizedProjectDir,
      normalizedSessionId,
      normalizedFilePath,
    );

    await sessionsStore.refreshFromBackend().catch(() => undefined);

    if (sessionsStore.sessions.length === 0) {
      const fallback =
        cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
      await createSession(fallback);
    } else if (!sessionsStore.activeSession) {
      const first = sessionsStore.sessions[0];
      if (first) {
        sessionsStore.setActiveSession(first.sessionId);
        await ensureRuntime(first);
        requestAnimationFrame(() => scrollToBottom(false));
      }
    }
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
      delete sessionRuntimes[session.sessionId];
      pendingSessionSidebarSync.delete(session.sessionId);
      clearOptimisticFirstPrompt(session.sessionId);
    }

    // Delete the scope (session files) via backend
    await projectScopesStore.deleteScope(normalizedProjectDir);

    // Refresh session list
    await sessionsStore.refreshFromBackend().catch(() => undefined);

    // If no sessions remain, create a new one with the current cwd
    if (sessionsStore.sessions.length === 0) {
      const fallback =
        cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
      await createSession(fallback);
    } else if (!sessionsStore.activeSession) {
      // Switch to first available session
      const first = sessionsStore.sessions[0];
      if (first) {
        sessionsStore.setActiveSession(first.sessionId);
        await ensureRuntime(first);
        requestAnimationFrame(() => scrollToBottom(false));
      }
    }
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
    if (!activeRuntime || isLoading || !chatHasMessages) {
      return;
    }

    hideCompactRail = true;
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

  async function bootstrapSessions(): Promise<void> {
    await cwdStore.load();

    await projectScopesStore.refresh().catch(() => undefined);
    await sessionsStore.refreshFromBackend().catch(() => undefined);

    for (const descriptor of sessionsStore.sessions) {
      await ensureRuntime(descriptor);
    }

    if (sessionsStore.sessions.length === 0) {
      // Prefer the last selected scope from settings, fall back to cwd
      const lastScope = settingsStore.lastSelectedScope;
      const cwdFallback =
        cwdStore.cwd ?? (await invoke<string>("get_working_directory"));

      // Use last selected scope if it exists and is a valid directory
      let projectDir = cwdFallback;
      if (lastScope && lastScope.trim().length > 0) {
        try {
          // Check if it's a valid directory
          const scopeHistory = projectScopesStore.historyByScope[lastScope];
          const hasHistory = scopeHistory && scopeHistory.length > 0;

          if (hasHistory) {
            // Resume the most recent session for this scope
            const mostRecent = scopeHistory[0];
            if (mostRecent) {
              await createSession(lastScope, mostRecent.filePath);
              return;
            }
          }
          // No history - start fresh with the last selected scope
          projectDir = lastScope;
        } catch {
          // Fall back to cwd if lastScope is invalid
        }
      }

      await createSession(projectDir);
    } else {
      // Sessions exist - try to activate the last selected scope if it matches
      const lastScope = settingsStore.lastSelectedScope;
      if (lastScope && lastScope.trim().length > 0) {
        const normalizedLast = normalizeScopePath(lastScope);
        const matchingSession = sessionsStore.sessions.find(
          (s) => normalizeScopePath(s.projectDir) === normalizedLast,
        );
        if (matchingSession) {
          sessionsStore.setActiveSession(matchingSession.sessionId);
          await ensureRuntime(matchingSession);
          projectDirInput = matchingSession.projectDir;
          requestAnimationFrame(() => scrollToBottom(false));
          return;
        }
      }

      // No match - use the first available session
      const active = sessionsStore.activeSession;
      if (active) {
        await ensureRuntime(active);
      }
    }

    const active = sessionsStore.activeSession;
    if (active) {
      projectDirInput = active.projectDir;
      requestAnimationFrame(() => scrollToBottom(false));
    }
  }

  $effect(() => {
    const active = sessionsStore.activeSession;
    if (active) {
      projectDirInput = active.projectDir;
    }
  });

  $effect(() => {
    const validSessionIds = new Set(
      sessionsStore.sessions.map((s) => s.sessionId),
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
    document.documentElement.setAttribute(
      "data-display-mode",
      settingsStore.displayMode,
    );
  });

  $effect(() => {
    if (!isCompactMode && compactScopesSidebarOpen) {
      compactScopesSidebarOpen = false;
    }
  });

  $effect(() => {
    const layout = compactLayoutRef;

    compactLayoutResizeObserver?.disconnect();
    compactLayoutResizeObserver = null;

    if (!isCompactMode || !layout) {
      return;
    }

    if (typeof ResizeObserver !== "undefined") {
      compactLayoutResizeObserver = new ResizeObserver(() => {
        scheduleCompactHeightSync();
      });
      compactLayoutResizeObserver.observe(layout);
    }

    showCompactActivityRail;
    showCompactActivityRailShell;
    compactRailViewportClass;
    compactActivityItems.length;
    compactScopesSidebarOpen;
    isLoading;

    scheduleCompactHeightSync();

    return () => {
      compactLayoutResizeObserver?.disconnect();
      compactLayoutResizeObserver = null;
    };
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
        return applyWindowMode(settingsStore.displayMode).catch((error) => {
          console.warn("Failed to apply initial window mode:", error);
        });
      });

    void settingsLoad;

    try {
      await Promise.race([
        bootstrapSessions(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Session bootstrap timed out"));
          }, 20_000);
        }),
      ]);
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
    }

    unlistenEvent = await listen<
      string | { sessionId?: string; event?: AgentEvent }
    >("agent-event", (event) => {
      try {
        const payload =
          typeof event.payload === "string"
            ? (JSON.parse(event.payload) as unknown)
            : event.payload;

        if (!payload || typeof payload !== "object") {
          return;
        }

        const wrapped = payload as {
          sessionId?: unknown;
          event?: unknown;
          type?: unknown;
        };

        if (
          typeof wrapped.sessionId === "string" &&
          wrapped.event &&
          typeof wrapped.event === "object"
        ) {
          const runtime = sessionRuntimes[wrapped.sessionId];
          if (!runtime) {
            return;
          }

          const agentEvent = wrapped.event as AgentEvent;
          const userMessageCountBeforeEvent = runtime.messages.messages.filter(
            (message) => message.type === "user",
          ).length;

          handleAgentEvent(runtime, agentEvent);

          const isFirstUserMessageStart =
            agentEvent.type === "message_start" &&
            agentEvent.message.role === "user" &&
            userMessageCountBeforeEvent === 0;

          const isFirstUserMessageEnd =
            agentEvent.type === "message_end" &&
            agentEvent.message.role === "user" &&
            userMessageCountBeforeEvent <= 1;

          if (isFirstUserMessageStart || isFirstUserMessageEnd) {
            pendingSessionSidebarSync.add(wrapped.sessionId);
            scheduleSessionSidebarRefresh(240);
          } else if (
            pendingSessionSidebarSync.has(wrapped.sessionId) &&
            ((agentEvent.type === "message_end" &&
              agentEvent.message.role === "assistant") ||
              agentEvent.type === "turn_end" ||
              agentEvent.type === "agent_end")
          ) {
            // Session files are flushed once assistant output is persisted.
            // Run a follow-up refresh at turn/agent completion for reliability.
            scheduleSessionSidebarRefresh(280);
          }

          if (sessionsStore.activeSessionId === wrapped.sessionId) {
            scheduleScrollToBottom();
          }
        }
      } catch (e) {
        console.error("Failed to parse agent event:", e, event.payload);
      }
    });

    unlistenError = await listen<string>("agent-error", (event) => {
      handleAgentError(event.payload);
    });

    unlistenTerminated = await listen<number | null>(
      "agent-terminated",
      (event) => {
        handleAgentTerminated(event.payload);
      },
    );
  });

  onDestroy(() => {
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();

    if (sessionSidebarRefreshTimer) {
      clearTimeout(sessionSidebarRefreshTimer);
      sessionSidebarRefreshTimer = null;
    }

    if (scrollRaf !== null) {
      cancelAnimationFrame(scrollRaf);
      scrollRaf = null;
    }

    if (compactHeightRaf !== null) {
      cancelAnimationFrame(compactHeightRaf);
      compactHeightRaf = null;
    }

    compactLayoutResizeObserver?.disconnect();
    compactLayoutResizeObserver = null;

    pendingSessionSidebarSync.clear();
    optimisticFirstPromptBySession = {};
    promptDraftBySession = {};
    promptAttachmentDraftBySession = {};
  });
</script>

{#if isCompactMode}
  <main class="flex w-full h-screen overflow-hidden bg-transparent">
    <section class="flex items-end w-full h-full">
      <div
        bind:this={compactLayoutRef}
        class="flex w-full flex-col gap-1 px-1 py-1"
      >
        {#if showCompactActivityRailShell}
          <div
            class={`flex w-full flex-col justify-end overflow-hidden ${compactRailViewportClass}`}
            aria-hidden={!showCompactActivityRail}
          >
            {#if showCompactActivityRail}
              <CompactActivityRail
                items={compactActivityItems}
                assistantStreaming={isStreaming}
              />
            {/if}
          </div>
        {/if}

        <div
          id="compact-session-sidebar"
          class={`w-full overflow-hidden ${
            compactScopesSidebarOpen
              ? "max-h-[440px] pb-1"
              : "max-h-0 pointer-events-none"
          }`}
          aria-hidden={!compactScopesSidebarOpen}
        >
          <div
            class={`h-[440px] overflow-hidden rounded-2xl border-[2px] border-[rgba(255,255,255,0.92)] bg-background shadow-2xl transition-[opacity,transform] duration-200 ${
              compactScopesSidebarOpen
                ? "opacity-100 translate-y-0"
                : "opacity-0 -translate-y-2"
            }`}
          >
            <SessionSidebar
              {projectScopes}
              {scopeHistoryByProject}
              {activeProjectDir}
              {activeSessionId}
              {activeSessionFile}
              {projectDirInput}
              creating={sessionsStore.creating}
              collapsed={false}
              collapsedScopes={settingsStore.collapsedScopes}
              ontoggle={toggleCompactScopesSidebar}
              onprojectdirinput={onProjectDirInputChange}
              oncreatesession={createSessionFromInput}
              onselectscope={onSelectScope}
              onselecthistory={onSelectHistory}
              onremovehistory={onRemoveHistory}
              onremovescope={onRemoveScope}
              ontogglescopecollapse={async (scope) => {
                await settingsStore.toggleScopeCollapsed(scope);
              }}
            />
          </div>
        </div>

        <div class="relative w-full">
          <button
            type="button"
            class="absolute left-0 top-1/2 z-10 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 opacity-70 transition-opacity hover:opacity-100 active:opacity-100 cursor-ew-resize"
            onmousedown={(event) =>
              onCompactResizeHandleMouseDown(event, "West")}
            aria-label="Resize compact width from left edge"
            title="Resize width"
          ></button>

          <div
            class="flex items-center gap-2 w-full rounded-[999px] border-[3px] border-[rgba(255,255,255,0.92)] bg-background px-2 py-0.5 shadow-2xl"
          >
            <button
              type="button"
              class="shrink-0 h-9 w-9 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary cursor-move select-none"
              data-tauri-drag-region
              onmousedown={onCompactDragHandleMouseDown}
              aria-label="Move window"
              title="Move window"
            >
              <span data-tauri-drag-region class="text-base leading-none"
                >⋮</span
              >
            </button>

            <button
              type="button"
              class={`shrink-0 flex items-center justify-center h-9 w-9 rounded-full border text-sm font-semibold transition-colors ${
                compactScopesSidebarOpen
                  ? "border-foreground bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary"
              }`}
              onclick={toggleCompactScopesSidebar}
              aria-label={compactScopesSidebarOpen
                ? "Hide project scopes"
                : "Show project scopes"}
              aria-expanded={compactScopesSidebarOpen}
              aria-controls="compact-session-sidebar"
              title={compactScopeTooltip}
            >
              P
            </button>

            <div class="flex-1 min-w-0">
              <PromptInput
                value={activePromptDraft}
                attachments={activePromptAttachmentDraft}
                oninput={onPromptInput}
                onattachmentschange={onPromptAttachmentsChange}
                onsubmit={onSubmit}
                oncancel={onCancel}
                onslashcommand={onSlashCommand}
                onnewchat={onNewChat}
                onmodelchange={onModelChange}
                onthinkingchange={onThinkingChange}
                onmodelfilterchange={onModelFilterChange}
                {isLoading}
                disabled={!activeRuntime || !sessionStarted}
                placeholder={activeRuntime && sessionStarted
                  ? "What would you like to get done today?"
                  : "Create a session to begin..."}
                model={currentModel}
                provider={currentProvider}
                thinkingLevel={currentThinkingLevel}
                supportsImageInput={currentModelSupportsImageInput}
                {supportsThinking}
                {availableThinkingLevels}
                models={availableModels}
                modelsLoading={isModelsLoading}
                modelChanging={isSettingModel}
                thinkingChanging={isSettingThinking}
                enabledModels={activeRuntime?.enabledModels}
                modelFilter={settingsStore.modelFilter}
                autofocus={true}
                {chatHasMessages}
                compact={true}
              />
            </div>

            <button
              type="button"
              class="shrink-0 flex items-center justify-center h-9 w-9 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors"
              onclick={enterFullMode}
              aria-label="Switch to full mode"
              title="Full mode"
            >
              <svg
                aria-hidden="true"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M10 10L5 5" />
                <path d="M5 8V5H8" />
                <path d="M14 14L19 19" />
                <path d="M16 19H19V16" />
              </svg>
            </button>
          </div>

          <button
            type="button"
            class="absolute right-0 top-1/2 z-10 h-10 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 opacity-70 transition-opacity hover:opacity-100 active:opacity-100 cursor-ew-resize"
            onmousedown={(event) =>
              onCompactResizeHandleMouseDown(event, "East")}
            aria-label="Resize compact width from right edge"
            title="Resize width"
          ></button>
        </div>
      </div>
    </section>
  </main>
{:else}
  <main class="relative flex w-full h-screen overflow-hidden">
    <button
      type="button"
      class="absolute top-3 right-4 z-20 flex items-center justify-center h-9 w-9 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors"
      onclick={enterCompactMode}
      aria-label="Switch to compact mode"
      title="Compact mode"
    >
      <svg
        aria-hidden="true"
        class="h-4 w-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M5 5L10 10" />
        <path d="M7 10H10V7" />
        <path d="M19 19L14 14" />
        <path d="M17 14H14V17" />
      </svg>
    </button>

    <SessionSidebar
      {projectScopes}
      {scopeHistoryByProject}
      {activeProjectDir}
      {activeSessionId}
      {activeSessionFile}
      {projectDirInput}
      creating={sessionsStore.creating}
      collapsed={sidebarCollapsed}
      collapsedScopes={settingsStore.collapsedScopes}
      ontoggle={toggleSidebar}
      onprojectdirinput={onProjectDirInputChange}
      oncreatesession={createSessionFromInput}
      onselectscope={onSelectScope}
      onselecthistory={onSelectHistory}
      onremovehistory={onRemoveHistory}
      onremovescope={onRemoveScope}
      ontogglescopecollapse={async (scope) => {
        await settingsStore.toggleScopeCollapsed(scope);
      }}
    />

    <section
      class="flex-1 min-w-0 h-full flex items-stretch justify-center overflow-hidden"
    >
      <div
        class="flex flex-col w-full h-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] px-4 py-4"
      >
        <header class="shrink-0 py-2 text-center">
          <h1
            class="text-3xl font-semibold tracking-tight mb-1 bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent"
          >
            Graphone
          </h1>
          <p class="text-sm text-muted-foreground">Parallel project sessions</p>
        </header>

        <div
          class="flex-1 min-h-0 overflow-y-auto py-4 pl-2 pr-4 flex flex-col gap-2 scroll-smooth [scrollbar-gutter:stable]"
          bind:this={messagesContainerRef}
          onscroll={handleScroll}
        >
          {#if startupError}
            <div class="flex items-center justify-center h-full">
              <p class="text-destructive text-sm">
                Failed to initialize sessions: {startupError}
              </p>
            </div>
          {:else if !activeRuntime}
            <div class="flex items-center justify-center h-full">
              <p class="text-muted-foreground text-sm">
                Create a session to start chatting.
              </p>
            </div>
          {:else if messages.length === 0}
            <div class="flex items-center justify-center h-full">
              <p class="text-muted-foreground text-sm">
                Start a conversation by typing below
              </p>
            </div>
          {:else}
            {#each messages as message (message.id)}
              {#if message.type === "user"}
                <UserMessage
                  content={message.content}
                  timestamp={message.timestamp}
                />
              {:else}
                <AssistantMessage
                  content={message.content}
                  timestamp={message.timestamp}
                  isStreaming={message.isStreaming}
                />
              {/if}
            {/each}
          {/if}
        </div>

        <section class="shrink-0 w-full px-2 pb-1 pt-1">
          <PromptInput
            value={activePromptDraft}
            attachments={activePromptAttachmentDraft}
            oninput={onPromptInput}
            onattachmentschange={onPromptAttachmentsChange}
            onsubmit={onSubmit}
            oncancel={onCancel}
            onslashcommand={onSlashCommand}
            onnewchat={onNewChat}
            onmodelchange={onModelChange}
            onthinkingchange={onThinkingChange}
            onmodelfilterchange={onModelFilterChange}
            {isLoading}
            disabled={!activeRuntime || !sessionStarted}
            placeholder={activeRuntime && sessionStarted
              ? "What would you like to get done today?"
              : "Create a session to begin..."}
            model={currentModel}
            provider={currentProvider}
            thinkingLevel={currentThinkingLevel}
            supportsImageInput={currentModelSupportsImageInput}
            {supportsThinking}
            {availableThinkingLevels}
            models={availableModels}
            modelsLoading={isModelsLoading}
            modelChanging={isSettingModel}
            thinkingChanging={isSettingThinking}
            enabledModels={activeRuntime?.enabledModels}
            modelFilter={settingsStore.modelFilter}
            autofocus={true}
            {chatHasMessages}
          />
        </section>

        <StatusBar cwd={activeProjectDir} {usageIndicator} />
      </div>
    </section>
  </main>
{/if}
