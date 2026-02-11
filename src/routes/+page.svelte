<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { PromptInput } from '$lib/components/PromptInput';
  import { AssistantMessage, UserMessage } from '$lib/components/Messages';
  import type { Message, ContentBlock, AgentEvent, ThinkingBlock } from '$lib/types/agent';
  import { getCommandHandler } from '$lib/slash-commands';

  let isLoading = $state(false);
  let messages = $state<Message[]>([]);
  let messagesContainerRef = $state<HTMLDivElement | null>(null);
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;
  let isUserNearBottom = $state(true);

  function scrollToBottom(smooth = true) {
    if (messagesContainerRef && isUserNearBottom) {
      messagesContainerRef.scrollTo({
        top: messagesContainerRef.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }
  }

  function handleScroll() {
    if (messagesContainerRef) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef;
      // Consider "near bottom" if within 100px of the bottom
      isUserNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    }
  }

  // Configuration for the AI model
  // This uses the pi-cline-free-models extension which provides the "cline" provider
  // Make sure you have installed it: pi install npm:pi-cline-free-models
  const MODEL_CONFIG = {
    provider: "cline",
    model: "moonshotai/kimi-k2.5"
  };

  let sessionStarted = $state(false);

  onMount(async () => {
    // Start the agent session with configured provider and model
    try {
      console.log('Starting agent session with config:', MODEL_CONFIG);
      await invoke("start_agent_session", {
        provider: MODEL_CONFIG.provider,
        model: MODEL_CONFIG.model
      });
      console.log('Agent session started successfully');
      sessionStarted = true;
    } catch (error) {
      console.error('Failed to start agent session:', error);
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ type: 'text', text: `Failed to start session: ${error}` }],
        timestamp: new Date()
      };
      messages = [...messages, errorMsg];
    }

    // Listen for agent events
    unlistenEvent = await listen<string>("agent-event", (event) => {
      try {
        const data: AgentEvent = JSON.parse(event.payload);
        handleAgentEvent(data);
      } catch (e) {
        console.error('Failed to parse agent event:', e, event.payload);
      }
    });

    unlistenError = await listen<string>("agent-error", (event) => {
      console.error('Agent error:', event.payload);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ type: 'text', text: `Error: ${event.payload}` }],
        timestamp: new Date()
      };
      messages = [...messages, errorMessage];
      isLoading = false;
      streamingMessageId = null;
    });

    unlistenTerminated = await listen<number | null>("agent-terminated", (event) => {
      console.log('Agent terminated with code:', event.payload);
      isLoading = false;
      streamingMessageId = null;
    });
  });

  onDestroy(() => {
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();
  });

  // Track the streaming message ID to ensure updates go to the correct message
  let streamingMessageId: string | null = $state(null);

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'agent_start':
        isLoading = true;
        break;
      
      case 'agent_end':
        isLoading = false;
        // Update the streaming message to mark it as complete
        if (streamingMessageId) {
          const msgIndex = messages.findIndex(m => m.id === streamingMessageId);
          if (msgIndex >= 0) {
            const msg = messages[msgIndex];
            if (msg.type === 'assistant' && msg.isStreaming) {
              messages = messages.map((m, idx) => 
                idx === msgIndex ? { ...m, isStreaming: false } : m
              );
            }
          }
          streamingMessageId = null;
        }
        break;
      
      case 'message_update':
        handleMessageUpdate(event);
        break;
    }
    
    // Scroll after state updates, but only if user is near bottom
    requestAnimationFrame(() => scrollToBottom(true));
  }

  function handleMessageUpdate(event: Extract<AgentEvent, { type: 'message_update' }>) {
    // Get the current streaming message ID or create a new message
    let targetMessageId = streamingMessageId;
    let targetIndex = -1;

    if (targetMessageId) {
      targetIndex = messages.findIndex(m => m.id === targetMessageId);
    }

    // If no valid streaming message exists, create a new one
    if (targetIndex < 0) {
      const newMsg: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [],
        timestamp: new Date(),
        isStreaming: true
      };
      streamingMessageId = newMsg.id;
      targetMessageId = newMsg.id;
      targetIndex = messages.length;
      messages = [...messages, newMsg];
    }

    const targetMsg = messages[targetIndex];
    if (targetMsg.type !== 'assistant') return;

    // Use the complete message content from the event - this is the source of truth
    // The event.message contains the full assistant message with all content blocks
    const agentMessage = event.message;
    if (agentMessage.role !== 'assistant') return;

    // Convert the agent's content blocks to our ContentBlock format
    const newContent: ContentBlock[] = agentMessage.content.map(block => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text };
      }
      if (block.type === 'thinking') {
        return { type: 'thinking', thinking: block.thinking };
      }
      if (block.type === 'toolCall') {
        return {
          type: 'toolCall',
          id: block.id,
          name: block.name,
          arguments: block.arguments
        };
      }
      return { type: 'text', text: '' };
    });

    // Always update the message content to ensure we have the latest state
    messages = messages.map((m, idx) =>
      idx === targetIndex && m.type === 'assistant'
        ? { ...m, content: newContent }
        : m
    );
  }

  async function handleSubmit(prompt: string) {
    // Check if session is started
    if (!sessionStarted) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ type: 'text', text: 'Error: Agent session not started. Please wait for initialization.' }],
        timestamp: new Date()
      };
      messages = [...messages, errorMessage];
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      type: 'user',
      content: prompt,
      timestamp: new Date()
    };
    messages = [...messages, userMessage];
    
    // Scroll immediately on user submit
    requestAnimationFrame(() => scrollToBottom(false));
    
    try {
      await invoke("send_prompt", { prompt });
    } catch (error) {
      console.error('Error sending prompt:', error);
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ type: 'text', text: `Error: ${error}` }],
        timestamp: new Date()
      };
      messages = [...messages, errorMessage];
    }
  }

  function handleCancel() {
    invoke("abort_agent").catch(console.error);
    isLoading = false;
    streamingMessageId = null;
  }

  async function handleSlashCommand(command: string, args: string, fullText: string) {
    if (!sessionStarted) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ type: 'text', text: 'Error: Agent session not started. Please wait for initialization.' }],
        timestamp: new Date()
      };
      messages = [...messages, errorMessage];
      return;
    }

    const handler = getCommandHandler(command);

    if (handler === 'local') {
      // Handle local commands
      if (command === 'clear') {
        messages = [];
      }
      return;
    }

    if (handler === 'unimplemented') {
      // These commands require UI that we haven't implemented yet
      const systemMessage: Message = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [{ 
          type: 'text', 
          text: `Command "/${command}" requires a UI that hasn't been implemented yet in Graphone.\n\nThis command works in the terminal UI (TUI) mode.` 
        }],
        timestamp: new Date(),
        isStreaming: false
      };
      messages = [...messages, systemMessage];
      return;
    }

    if (handler === 'rpc') {
      // Extension commands, prompt templates, and skills work via RPC
      const userMessage: Message = {
        id: crypto.randomUUID(),
        type: 'user',
        content: fullText,
        timestamp: new Date()
      };
      messages = [...messages, userMessage];
      
      requestAnimationFrame(() => scrollToBottom(false));
      
      try {
        await invoke("send_prompt", { prompt: fullText });
      } catch (error) {
        console.error('Error sending slash command:', error);
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          type: 'assistant',
          content: [{ type: 'text', text: `Error: ${error}` }],
          timestamp: new Date()
        };
        messages = [...messages, errorMessage];
      }
      return;
    }

    // Unknown command - treat as regular message
    await handleSubmit(fullText);
  }
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
        
        {#if isLoading && !messages.some(m => m.type === 'assistant' && m.isStreaming)}
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
        onsubmit={handleSubmit}
        oncancel={handleCancel}
        onslashcommand={handleSlashCommand}
        isLoading={isLoading}
        disabled={!sessionStarted}
        placeholder={sessionStarted ? "What would you like to know? Try /login, /model, /help..." : "Initializing agent session..."}
        autofocus={true}
      />
    </section>
  </div>
</main>
