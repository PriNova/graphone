<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { invoke } from "@tauri-apps/api/core";
  import { PromptInput } from '$lib/components/PromptInput';
  import { AssistantMessage, UserMessage } from '$lib/components/Messages';
  import type { Message, ContentBlock, AgentEvent, ThinkingBlock } from '$lib/types/agent';

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
    });

    unlistenTerminated = await listen<number | null>("agent-terminated", (event) => {
      console.log('Agent terminated with code:', event.payload);
      isLoading = false;
    });
  });

  onDestroy(() => {
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();
  });

  function handleAgentEvent(event: AgentEvent) {
    switch (event.type) {
      case 'agent_start':
        isLoading = true;
        break;
      
      case 'agent_end':
        isLoading = false;
        // Update the last assistant message to mark it as complete
        if (messages.length > 0) {
          const lastMsg = messages[messages.length - 1];
          if (lastMsg.type === 'assistant') {
            lastMsg.isStreaming = false;
            messages = [...messages];
          }
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
    const { assistantMessageEvent } = event;

    // Get or create the last assistant message
    let lastMsg: Message | undefined = messages[messages.length - 1];

    if (!lastMsg || lastMsg.type !== 'assistant' || !lastMsg.isStreaming) {
      // Create a new assistant message
      lastMsg = {
        id: crypto.randomUUID(),
        type: 'assistant',
        content: [],
        timestamp: new Date(),
        isStreaming: true
      };
      messages = [...messages, lastMsg];
    }

    // Always work with immutable updates to trigger reactivity
    const currentContent = lastMsg.content;
    const { type, contentIndex = 0 } = assistantMessageEvent;
    let newContent = currentContent;

    switch (type) {
      case 'text_start':
        newContent = [...currentContent, { type: 'text', text: '' }];
        break;

      case 'text_delta':
        // Try to use contentIndex if valid, otherwise find the last text block
        let textIndex = contentIndex;
        if (currentContent[textIndex]?.type !== 'text') {
          textIndex = currentContent.findLastIndex(b => b.type === 'text');
        }
        if (textIndex >= 0 && currentContent[textIndex]?.type === 'text') {
          newContent = currentContent.map((block, idx) =>
            idx === textIndex && block.type === 'text'
              ? { ...block, text: block.text + (assistantMessageEvent.delta || '') }
              : block
          );
        }
        break;

      case 'thinking_start':
        newContent = [...currentContent, { type: 'thinking', thinking: '' }];
        break;

      case 'thinking_delta':
        // Find the last thinking block and update it
        const lastThinkingIndex = currentContent.findLastIndex(b => b.type === 'thinking');
        if (lastThinkingIndex >= 0) {
          newContent = currentContent.map((block, idx) =>
            idx === lastThinkingIndex && block.type === 'thinking'
              ? { ...block, thinking: block.thinking + (assistantMessageEvent.delta || '') }
              : block
          );
        }
        break;

      case 'toolcall_start':
        // Tool call is added on toolcall_end with full data
        break;

      case 'toolcall_end':
        if (assistantMessageEvent.toolCall) {
          newContent = [...currentContent, assistantMessageEvent.toolCall];
        }
        break;
    }

    // Update the message with new content array to trigger reactivity
    if (newContent !== currentContent) {
      lastMsg.content = newContent;
      messages = [...messages];
    }
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
  }
</script>

<main class="main-container">
  <div class="content">
    <header class="header">
      <h1 class="title">Graphone</h1>
      <p class="subtitle">Ask me anything</p>
    </header>

    <!-- Messages area -->
    <div class="messages-container" bind:this={messagesContainerRef} onscroll={handleScroll}>
      {#if messages.length === 0}
        <div class="empty-state">
          <p class="empty-text">Start a conversation by typing below</p>
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
          <div class="loading-indicator">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Input area fixed at bottom -->
    <section class="input-section">
      <PromptInput
        onsubmit={handleSubmit}
        oncancel={handleCancel}
        isLoading={isLoading}
        disabled={!sessionStarted}
        placeholder={sessionStarted ? "What would you like to know?" : "Initializing agent session..."}
        autofocus={true}
      />
    </section>
  </div>
</main>

<style>
  .main-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 1rem 1rem;
    height: 100vh;
    max-height: 100vh;
    overflow: hidden;
  }

  .content {
    width: 100%;
    max-width: min(95vw, 1200px);
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .header {
    text-align: center;
    padding: 1rem 0;
    flex-shrink: 0;
  }

  .title {
    font-size: 2rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    margin-bottom: 0.25rem;
    background: linear-gradient(135deg, var(--foreground) 0%, var(--muted-foreground) 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    font-size: 0.875rem;
    color: var(--muted-foreground);
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    scroll-behavior: smooth;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
  }

  .empty-text {
    color: var(--muted-foreground);
    font-size: 0.875rem;
  }

  .loading-indicator {
    display: flex;
    justify-content: flex-start;
    animation: fadeIn 0.3s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .typing-indicator {
    display: flex;
    gap: 4px;
    padding: 0.5rem 0;
  }

  .typing-indicator span {
    width: 8px;
    height: 8px;
    background: var(--muted-foreground);
    border-radius: 50%;
    animation: bounce 1.4s ease-in-out infinite;
  }

  .typing-indicator span:nth-child(1) {
    animation-delay: -0.32s;
  }

  .typing-indicator span:nth-child(2) {
    animation-delay: -0.16s;
  }

  @keyframes bounce {
    0%, 80%, 100% {
      transform: scale(0);
      opacity: 0.5;
    }
    40% {
      transform: scale(1);
      opacity: 1;
    }
  }

  .input-section {
    width: 100%;
    padding: 0.5rem 0.5rem 1rem;
    flex-shrink: 0;
  }

  /* Dark mode adjustments */
  @media (prefers-color-scheme: dark) {
    .title {
      background: linear-gradient(135deg, var(--foreground) 0%, var(--muted-foreground) 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
  }

  /* Large screens */
  @media (min-width: 1400px) {
    .content {
      max-width: min(90vw, 1400px);
    }
  }

  /* Responsive adjustments */
  @media (max-width: 640px) {
    .main-container {
      padding: 0.5rem;
    }

    .title {
      font-size: 1.75rem;
    }

    .header {
      padding: 0.75rem 0;
    }
  }
</style>
