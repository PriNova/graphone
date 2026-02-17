<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";

  import { AssistantMessage, UserMessage } from "$lib/components/Messages";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { handleAgentEvent } from "$lib/handlers/agent-events";
  import { handlePromptSubmit, handleSlashCommand } from "$lib/handlers/commands";
  import { createAgentStore } from "$lib/stores/agent.svelte";
  import { cwdStore } from "$lib/stores/cwd.svelte";
  import { createEnabledModelsStore } from "$lib/stores/enabledModels.svelte";
  import { createMessagesStore } from "$lib/stores/messages.svelte";
  import { sessionsStore, type SessionDescriptor } from "$lib/stores/sessions.svelte";
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

  const sessions = $derived(sessionsStore.sessions);
  const activeSessionId = $derived(sessionsStore.activeSessionId);
  const activeRuntime = $derived(activeSessionId ? sessionRuntimes[activeSessionId] ?? null : null);

  const messages = $derived(activeRuntime ? activeRuntime.messages.messages : []);
  const isLoading = $derived(activeRuntime ? activeRuntime.agent.isLoading : false);
  const sessionStarted = $derived(activeRuntime ? activeRuntime.agent.sessionStarted : false);
  const currentModel = $derived(activeRuntime ? activeRuntime.agent.currentModel : "");
  const currentProvider = $derived(activeRuntime ? activeRuntime.agent.currentProvider : "");
  const availableModels = $derived(activeRuntime ? activeRuntime.agent.availableModels : []);
  const isModelsLoading = $derived(activeRuntime ? activeRuntime.agent.isModelsLoading : false);
  const isSettingModel = $derived(activeRuntime ? activeRuntime.agent.isSettingModel : false);
  const isStreaming = $derived(activeRuntime ? activeRuntime.messages.streamingMessageId !== null : false);
  const activeProjectDir = $derived(activeRuntime ? activeRuntime.projectDir : null);

  function handleScroll(): void {
    if (messagesContainerRef && activeRuntime) {
      activeRuntime.messages.updateScrollPosition(messagesContainerRef);
    }
  }

  function scrollToBottom(smooth = true): void {
    activeRuntime?.messages.scrollToBottom(messagesContainerRef, smooth);
  }

  async function loadMessages(runtime: SessionRuntime): Promise<void> {
    try {
      const response = await invoke<
        | { success: true; data: { messages: Array<{ role: string; content: unknown; timestamp?: number }> } }
        | { success: false; error: string }
      >("get_messages", { sessionId: runtime.sessionId });

      if (response && typeof response === "object" && "success" in response && response.success) {
        runtime.messages.loadFromAgentMessages(response.data.messages);
      }
    } catch (error) {
      runtime.messages.addErrorMessage(`Failed to load messages: ${error}`);
    }
  }

  async function initializeRuntime(descriptor: SessionDescriptor): Promise<SessionRuntime> {
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

  async function ensureRuntime(descriptor: SessionDescriptor): Promise<SessionRuntime> {
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

  function removeRuntime(sessionId: string): void {
    const next = { ...sessionRuntimes };
    delete next[sessionId];
    sessionRuntimes = next;
  }

  async function createSession(projectDir: string): Promise<void> {
    const descriptor = await sessionsStore.createSession(projectDir);
    await ensureRuntime(descriptor);
    projectDirInput = "";
    requestAnimationFrame(() => scrollToBottom(false));
  }

  async function createSessionFromInput(): Promise<void> {
    const value = projectDirInput.trim();
    const fallback = cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
    const projectDir = value.length > 0 ? value : fallback;
    await createSession(projectDir);
  }

  function toggleSidebar(): void {
    sidebarCollapsed = !sidebarCollapsed;
  }

  function onProjectDirInputChange(value: string): void {
    projectDirInput = value;
  }

  async function closeSessionById(sessionId: string): Promise<void> {
    const wasActive = sessionsStore.activeSessionId === sessionId;

    await sessionsStore.closeSession(sessionId);
    removeRuntime(sessionId);

    if (wasActive) {
      const nextActive = sessionsStore.activeSession;
      if (nextActive) {
        await ensureRuntime(nextActive);
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
  }

  function onCancel(): void {
    activeRuntime?.agent.abort();
  }

  async function onModelChange(provider: string, modelId: string): Promise<void> {
    if (!activeRuntime) return;

    try {
      await activeRuntime.agent.setModel(provider, modelId);
    } catch (error) {
      activeRuntime.messages.addErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function onSlashCommand(command: string, args: string, fullText: string): Promise<void> {
    if (!activeRuntime) return;

    const result = await handleSlashCommand(activeRuntime, command, args, fullText);

    switch (result.type) {
      case "error":
        activeRuntime.messages.addErrorMessage(result.message);
        break;
      case "submit":
        await handlePromptSubmit(activeRuntime, result.text);
        break;
      case "handled":
        break;
    }
  }

  async function bootstrapSessions(): Promise<void> {
    await cwdStore.load();

    await sessionsStore.refreshFromBackend().catch(() => undefined);

    for (const descriptor of sessionsStore.sessions) {
      await ensureRuntime(descriptor);
    }

    if (sessionsStore.sessions.length === 0) {
      const fallback = cwdStore.cwd ?? (await invoke<string>("get_working_directory"));
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

    unlistenEvent = await listen<string | { sessionId?: string; event?: AgentEvent }>("agent-event", (event) => {
      try {
        const payload =
          typeof event.payload === "string" ? JSON.parse(event.payload) as unknown : event.payload;

        if (!payload || typeof payload !== "object") {
          return;
        }

        const wrapped = payload as { sessionId?: unknown; event?: unknown; type?: unknown };

        if (typeof wrapped.sessionId === "string" && wrapped.event && typeof wrapped.event === "object") {
          const runtime = sessionRuntimes[wrapped.sessionId];
          if (!runtime) {
            return;
          }

          handleAgentEvent(runtime, wrapped.event as AgentEvent);
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

    unlistenTerminated = await listen<number | null>("agent-terminated", (event) => {
      handleAgentTerminated(event.payload);
    });
  });

  onDestroy(() => {
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();
  });
</script>

<main class="flex w-full h-screen overflow-hidden">
  <SessionSidebar
    {sessions}
    {activeSessionId}
    {projectDirInput}
    creating={sessionsStore.creating}
    collapsed={sidebarCollapsed}
    ontoggle={toggleSidebar}
    onprojectdirinput={onProjectDirInputChange}
    oncreatesession={createSessionFromInput}
    onselectsession={(sessionId) => sessionsStore.setActiveSession(sessionId)}
    onclosesession={closeSessionById}
  />

  <section class="flex-1 min-w-0 h-full flex items-stretch justify-center overflow-hidden">
    <div class="flex flex-col w-full h-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] px-4 py-4">
      <header class="shrink-0 py-2 text-center">
        <h1 class="text-3xl font-semibold tracking-tight mb-1 bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
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
            <p class="text-destructive text-sm">Failed to initialize sessions: {startupError}</p>
          </div>
        {:else if !activeRuntime}
          <div class="flex items-center justify-center h-full">
            <p class="text-muted-foreground text-sm">Create a session to start chatting.</p>
          </div>
        {:else if messages.length === 0}
          <div class="flex items-center justify-center h-full">
            <p class="text-muted-foreground text-sm">Start a conversation by typing below</p>
          </div>
        {:else}
          {#each messages as message (message.id)}
            {#if message.type === "user"}
              <UserMessage content={message.content} timestamp={message.timestamp} />
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
                <span class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.32s]"></span>
                <span class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce [animation-delay:-0.16s]"></span>
                <span class="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></span>
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
          placeholder={
            activeRuntime && sessionStarted
              ? "What would you like to know? Try /new, /help..."
              : "Create a session to begin..."
          }
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
