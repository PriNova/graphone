<script lang="ts">
  import { AssistantMessage, UserMessage } from "$lib/components/Messages";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { StatusBar } from "$lib/components/StatusBar";
  import type {
    AvailableModel,
    ThinkingLevel,
    UsageIndicatorSnapshot,
  } from "$lib/stores/agent.svelte";
  import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
  import type { SessionDescriptor } from "$lib/stores/sessions.svelte";
  import type { Message, PromptImageAttachment } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";

  interface Props {
    projectScopes?: string[];
    scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
    activeProjectDir?: string | null;
    activeSessionId?: string | null;
    activeSessionFile?: string | null;
    busySessionIds?: string[];
    busySessionFiles?: string[];
    projectDirInput?: string;
    sessionsCreating?: boolean;
    sidebarCollapsed?: boolean;
    collapsedScopes?: string[];
    activeSession?: SessionDescriptor | null;
    startupError?: string | null;
    activeRuntime?: SessionRuntime | null;
    messages?: Message[];
    activePromptDraft?: string;
    activePromptAttachmentDraft?: PromptImageAttachment[];
    isLoading?: boolean;
    sessionStarted?: boolean;
    currentModel?: string;
    currentProvider?: string;
    currentThinkingLevel?: ThinkingLevel;
    currentModelSupportsImageInput?: boolean;
    supportsThinking?: boolean;
    availableThinkingLevels?: ThinkingLevel[];
    availableModels?: AvailableModel[];
    isModelsLoading?: boolean;
    isSettingModel?: boolean;
    isSettingThinking?: boolean;
    modelFilter?: "all" | "enabled";
    chatHasMessages?: boolean;
    usageIndicator?: UsageIndicatorSnapshot | null;
    onmessagescroll?: () => void;
    onmessagescontainerchange?: (element: HTMLDivElement | null) => void;
    ontogglesidebar?: () => void;
    onprojectdirinput?: (value: string) => void;
    oncreatesession?: () => void | Promise<void>;
    onselectscope?: (projectDir: string) => void | Promise<void>;
    onselecthistory?: (
      projectDir: string,
      history: PersistedSessionHistoryItem,
    ) => void | Promise<void>;
    onopenhistorywindow?: (
      projectDir: string,
      history: PersistedSessionHistoryItem,
    ) => void | Promise<void>;
    onremovehistory?: (
      projectDir: string,
      history: PersistedSessionHistoryItem,
    ) => void | Promise<void>;
    onremovescope?: (projectDir: string) => void | Promise<void>;
    ontogglescopecollapse?: (projectDir: string) => void | Promise<void>;
    onpopoutactivesession?: () => void | Promise<void>;
    onentercompactmode?: () => void | Promise<void>;
    onpromptinput?: (value: string) => void;
    onpromptattachmentschange?: (images: PromptImageAttachment[]) => void;
    onsubmit?: (
      prompt: string,
      images?: PromptImageAttachment[],
    ) => void | Promise<void>;
    oncancel?: () => void;
    onslashcommand?: (
      command: string,
      args: string,
      fullText: string,
    ) => void | Promise<void>;
    onnewchat?: () => void | Promise<void>;
    onmodelchange?: (provider: string, modelId: string) => void | Promise<void>;
    onthinkingchange?: (level: ThinkingLevel) => void | Promise<void>;
    onmodelfilterchange?: (mode: "all" | "enabled") => void | Promise<void>;
  }

  let {
    projectScopes = [],
    scopeHistoryByProject = {},
    activeProjectDir = null,
    activeSessionId = null,
    activeSessionFile = null,
    busySessionIds = [],
    busySessionFiles = [],
    projectDirInput = "",
    sessionsCreating = false,
    sidebarCollapsed = false,
    collapsedScopes = [],
    activeSession = null,
    startupError = null,
    activeRuntime = null,
    messages = [],
    activePromptDraft = "",
    activePromptAttachmentDraft = [],
    isLoading = false,
    sessionStarted = false,
    currentModel = "",
    currentProvider = "",
    currentThinkingLevel = "off",
    currentModelSupportsImageInput = false,
    supportsThinking = false,
    availableThinkingLevels = ["off"],
    availableModels = [],
    isModelsLoading = false,
    isSettingModel = false,
    isSettingThinking = false,
    modelFilter = "enabled",
    chatHasMessages = false,
    usageIndicator = null,
    onmessagescroll,
    onmessagescontainerchange,
    ontogglesidebar,
    onprojectdirinput,
    oncreatesession,
    onselectscope,
    onselecthistory,
    onopenhistorywindow,
    onremovehistory,
    onremovescope,
    ontogglescopecollapse,
    onpopoutactivesession,
    onentercompactmode,
    onpromptinput,
    onpromptattachmentschange,
    onsubmit,
    oncancel,
    onslashcommand,
    onnewchat,
    onmodelchange,
    onthinkingchange,
    onmodelfilterchange,
  }: Props = $props();

  let messagesContainerElement = $state<HTMLDivElement | null>(null);

  $effect(() => {
    onmessagescontainerchange?.(messagesContainerElement);
  });

  function getToolResult(toolCallId: string) {
    return activeRuntime?.messages.getToolResult(toolCallId);
  }
</script>

<main class="relative flex w-full h-screen overflow-hidden">
  <button
    type="button"
    class="absolute top-3 right-14 z-20 flex items-center justify-center h-9 w-9 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    onclick={onpopoutactivesession}
    disabled={!activeSession}
    aria-label="Detach Session"
    title={activeSession ? "Detach Session" : "No active session"}
  >
    <svg
      aria-hidden="true"
      class="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <rect x="4" y="4" width="16" height="12" rx="2"></rect>
      <path d="M9 20h6"></path>
    </svg>
  </button>

  <button
    type="button"
    class="absolute top-3 right-4 z-20 flex items-center justify-center h-9 w-9 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors"
    onclick={onentercompactmode}
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
    {busySessionIds}
    {busySessionFiles}
    {projectDirInput}
    creating={sessionsCreating}
    collapsed={sidebarCollapsed}
    {collapsedScopes}
    ontoggle={ontogglesidebar}
    {onprojectdirinput}
    {oncreatesession}
    {onselectscope}
    {onselecthistory}
    {onopenhistorywindow}
    {onremovehistory}
    {onremovescope}
    {ontogglescopecollapse}
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
        bind:this={messagesContainerElement}
        onscroll={onmessagescroll}
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
                {getToolResult}
              />
            {/if}
          {/each}
        {/if}
      </div>

      <section class="shrink-0 w-full px-2 pb-1 pt-1">
        <PromptInput
          value={activePromptDraft}
          attachments={activePromptAttachmentDraft}
          oninput={onpromptinput}
          onattachmentschange={onpromptattachmentschange}
          {onsubmit}
          {oncancel}
          {onslashcommand}
          {onnewchat}
          {onmodelchange}
          {onthinkingchange}
          {onmodelfilterchange}
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
          {modelFilter}
          autofocus={true}
          {chatHasMessages}
        />
      </section>

      <StatusBar cwd={activeProjectDir} {usageIndicator} />
    </div>
  </section>
</main>
