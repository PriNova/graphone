<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { PromptInput } from '$lib/components/PromptInput';
  import { AssistantMessage, UserMessage } from '$lib/components/Messages';
  import type { AgentEvent } from '$lib/types/agent';
  import { agentStore } from '$lib/stores/agent.svelte';
  import { messagesStore } from '$lib/stores/messages.svelte';
  import { handleAgentEvent } from '$lib/handlers/agent-events';
  import { handleSlashCommand, handlePromptSubmit } from '$lib/handlers/commands';
  import { cwdStore } from '$lib/stores/cwd.svelte';

  // DOM refs
  let messagesContainerRef = $state<HTMLDivElement | null>(null);

  // Event unlisteners
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;

  // Reactive state from stores
  const messages = $derived(messagesStore.messages);
  const isLoading = $derived(agentStore.isLoading);
  const sessionStarted = $derived(agentStore.sessionStarted);
  const currentModel = $derived(agentStore.currentModel);
  const currentProvider = $derived(agentStore.currentProvider);
  const availableModels = $derived(agentStore.availableModels);
  const isModelsLoading = $derived(agentStore.isModelsLoading);
  const isSettingModel = $derived(agentStore.isSettingModel);
  const isStreaming = $derived(messagesStore.streamingMessageId !== null);

  // Scroll management
  function handleScroll(): void {
    if (messagesContainerRef) {
      messagesStore.updateScrollPosition(messagesContainerRef);
    }
  }

  function scrollToBottom(smooth = true): void {
    messagesStore.scrollToBottom(messagesContainerRef, smooth);
  }

  // Load messages from backend
  async function loadMessages(): Promise<void> {
    try {
      const response = await invoke<
        { success: true; data: { messages: Array<{ role: string; content: unknown; timestamp?: number }> } } | 
        { success: false; error: string }
      >("get_messages");

      if (response && typeof response === 'object' && 'success' in response && response.success) {
        messagesStore.loadFromAgentMessages(response.data.messages);
        requestAnimationFrame(() => scrollToBottom(false));
      }
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  // Handle agent errors
  function handleAgentError(errorPayload: string): void {
    console.error('Agent error:', errorPayload);
    messagesStore.addErrorMessage(errorPayload);
    agentStore.setLoading(false);
    messagesStore.setStreamingMessageId(null);
  }

  // Handle agent termination
  function handleAgentTerminated(exitCode: number | null): void {
    console.log('Agent terminated with code:', exitCode);
    agentStore.setLoading(false);
    messagesStore.setStreamingMessageId(null);
  }

  // Event handlers from child components
  async function onSubmit(prompt: string): Promise<void> {
    await handlePromptSubmit(prompt);
  }

  function onCancel(): void {
    agentStore.abort();
  }

  async function onModelChange(provider: string, modelId: string): Promise<void> {
    try {
      await agentStore.setModel(provider, modelId);
    } catch (error) {
      messagesStore.addErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function onSlashCommand(command: string, args: string, fullText: string): Promise<void> {
    const result = await handleSlashCommand(command, args, fullText);

    switch (result.type) {
      case 'error':
        messagesStore.addErrorMessage(result.message);
        break;
      case 'submit':
        await handlePromptSubmit(result.text);
        break;
      case 'handled':
        // Nothing to do
        break;
    }
  }

  // Lifecycle
  onMount(async () => {
    // Load working directory
    await cwdStore.load();

    // Start agent session
    try {
      await agentStore.startSession();
      await loadMessages();
      await agentStore.loadAvailableModels().catch((error) => {
        console.warn('Failed to load available models:', error);
      });
    } catch (error) {
      messagesStore.addErrorMessage(`Failed to start session: ${error}`);
    }

    // Subscribe to agent events
    unlistenEvent = await listen<string>("agent-event", (event) => {
      try {
        const data: AgentEvent = JSON.parse(event.payload);
        handleAgentEvent(data);
        requestAnimationFrame(() => scrollToBottom(true));
      } catch (e) {
        console.error('Failed to parse agent event:', e, event.payload);
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

<main class="flex flex-col items-center w-full h-screen overflow-hidden">
  <div class="flex flex-col w-full h-full max-w-[min(95vw,1200px)] lg:max-w-[min(90vw,1400px)] px-4 py-4">
    <!-- Header -->
    <header class="shrink-0 text-center py-4">
      <h1 class="text-3xl font-semibold tracking-tight mb-1 bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
        Graphone
      </h1>
      <p class="text-sm text-muted-foreground">Ask me anything</p>
    </header>

    <!-- Messages area -->
    <div
      class="flex-1 min-h-0 overflow-y-auto py-4 px-2 flex flex-col gap-4 scroll-smooth"
      bind:this={messagesContainerRef}
      onscroll={handleScroll}
    >
      {#if messages.length === 0}
        <div class="flex items-center justify-center h-full">
          <p class="text-muted-foreground text-sm">Start a conversation by typing below</p>
        </div>
      {:else}
        {#each messages as message (message.id)}
          {#if message.type === 'user'}
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

    <!-- Input area fixed at bottom -->
    <section class="shrink-0 w-full px-2 pb-4 pt-2">
      <PromptInput
        onsubmit={onSubmit}
        oncancel={onCancel}
        onslashcommand={onSlashCommand}
        onmodelchange={onModelChange}
        {isLoading}
        disabled={!sessionStarted}
        placeholder={sessionStarted ? "What would you like to know? Try /new, /help..." : "Initializing agent session..."}
        model={currentModel}
        provider={currentProvider}
        models={availableModels}
        modelsLoading={isModelsLoading}
        modelChanging={isSettingModel}
        autofocus={true}
        cwd={cwdStore.cwd}
        cwdLoading={cwdStore.loading}
      />
    </section>
  </div>
</main>
