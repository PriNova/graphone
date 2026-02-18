<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";

  import { AssistantMessage, UserMessage } from "$lib/components/Messages";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import {
    handlePromptSubmit,
    handleSlashCommand,
  } from "$lib/handlers/commands";
  import { createAgentStore } from "$lib/stores/agent.svelte";
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
  import type { AgentEvent } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";

  // DOM refs
  let messagesContainerRef = $state<HTMLDivElement | null>(null);

  // Event unlisteners
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;

  let sessionRuntimes = $state<Record<string, SessionRuntime>>({});
  let projectDirInput = $state("");
  let startupError = $state<string | null>(null);
  let sidebarCollapsed = $state(false);
  let sessionSidebarRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  const sessions = $derived(sessionsStore.sessions);
  const activeSessionId = $derived(sessionsStore.activeSessionId);
  const activeSession = $derived(sessionsStore.activeSession);
  const activeSessionFile = $derived(activeSession?.sessionFile ?? null);
  const persistedProjectScopes = $derived(projectScopesStore.scopes);
  const scopeHistoryByProject = $derived(projectScopesStore.historyByScope);

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
  const availableModels = $derived(
    activeRuntime ? activeRuntime.agent.availableModels : [],
  );
  const isModelsLoading = $derived(
    activeRuntime ? activeRuntime.agent.isModelsLoading : false,
  );
  const isSettingModel = $derived(
    activeRuntime ? activeRuntime.agent.isSettingModel : false,
  );
  const isStreaming = $derived(
    activeRuntime ? activeRuntime.messages.streamingMessageId !== null : false,
  );
  const activeProjectDir = $derived(
    activeRuntime ? normalizeScopePath(activeRuntime.projectDir) : null,
  );

  function handleScroll(): void {
    if (messagesContainerRef && activeRuntime) {
      activeRuntime.messages.updateScrollPosition(messagesContainerRef);
    }
  }

  function scrollToBottom(smooth = true): void {
    activeRuntime?.messages.scrollToBottom(messagesContainerRef, smooth);
  }

  function scheduleSessionSidebarRefresh(delayMs = 450): void {
    if (sessionSidebarRefreshTimer) {
      clearTimeout(sessionSidebarRefreshTimer);
      sessionSidebarRefreshTimer = null;
    }

    sessionSidebarRefreshTimer = setTimeout(() => {
      void projectScopesStore.refresh().catch(() => undefined);
      void sessionsStore.refreshFromBackend().catch(() => undefined);
      sessionSidebarRefreshTimer = null;
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

    await createSession(projectDir);
  }

  async function onSelectHistory(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    const existing = sessionsStore.sessions.find(
      (session) => session.sessionFile === history.filePath,
    );
    if (existing) {
      sessionsStore.setActiveSession(existing.sessionId);
      await ensureRuntime(existing);
      requestAnimationFrame(() => scrollToBottom(false));
      return;
    }

    await createSession(projectDir, history.filePath);
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

  async function onSubmit(prompt: string): Promise<void> {
    if (!activeRuntime) return;
    await handlePromptSubmit(activeRuntime, prompt);
    scheduleSessionSidebarRefresh(900);
  }

  function onCancel(): void {
    activeRuntime?.agent.abort();
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

  async function onSlashCommand(
    command: string,
    args: string,
    fullText: string,
  ): Promise<void> {
    if (!activeRuntime) return;

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
        await handlePromptSubmit(activeRuntime, result.text);
        scheduleSessionSidebarRefresh(900);
        break;
      case "handled":
        if (command === "new") {
          scheduleSessionSidebarRefresh(250);
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
      const fallback =
        cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
      await createSession(fallback);
    } else {
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

  onMount(async () => {
    try {
      await bootstrapSessions();
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
          handleAgentEvent(runtime, agentEvent);

          if (
            agentEvent.type === "turn_end" ||
            agentEvent.type === "agent_end" ||
            (agentEvent.type === "message_start" &&
              agentEvent.message.role === "user")
          ) {
            scheduleSessionSidebarRefresh(
              agentEvent.type === "message_start" ? 220 : 300,
            );
          }

          if (sessionsStore.activeSessionId === wrapped.sessionId) {
            requestAnimationFrame(() => scrollToBottom(true));
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
  });
</script>

<main class="flex w-full h-screen overflow-hidden">
  <SessionSidebar
    {projectScopes}
    {scopeHistoryByProject}
    {activeProjectDir}
    {activeSessionId}
    {activeSessionFile}
    {projectDirInput}
    creating={sessionsStore.creating}
    collapsed={sidebarCollapsed}
    ontoggle={toggleSidebar}
    onprojectdirinput={onProjectDirInputChange}
    oncreatesession={createSessionFromInput}
    onselectscope={onSelectScope}
    onselecthistory={onSelectHistory}
    onremovescope={onRemoveScope}
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
        class="flex-1 min-h-0 overflow-y-auto py-4 px-2 flex flex-col gap-2 scroll-smooth"
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

          {#if isLoading && !isStreaming}
            <div class="flex justify-start animate-fade-in">
              <div class="flex gap-1 py-2">
                <span
                  class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.32s]"
                ></span>
                <span
                  class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.16s]"
                ></span>
                <span
                  class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
                ></span>
              </div>
            </div>
          {/if}
        {/if}
      </div>

      <section class="shrink-0 w-full px-2 pb-4 pt-2">
        <PromptInput
          onsubmit={onSubmit}
          oncancel={onCancel}
          onslashcommand={onSlashCommand}
          onmodelchange={onModelChange}
          {isLoading}
          disabled={!activeRuntime || !sessionStarted}
          placeholder={activeRuntime && sessionStarted
            ? "What would you like to know?"
            : "Create a session to begin..."}
          model={currentModel}
          provider={currentProvider}
          models={availableModels}
          modelsLoading={isModelsLoading}
          modelChanging={isSettingModel}
          enabledModels={activeRuntime?.enabledModels}
          autofocus={true}
          cwd={activeProjectDir}
          cwdLoading={false}
        />
      </section>
    </div>
  </section>
</main>
