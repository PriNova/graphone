<script lang="ts">
  import { AssistantMessage, UserMessage } from "$lib/components/Messages";
  import SettingsOverlay from "$lib/components/layout/SettingsOverlay.svelte";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { StatusBar } from "$lib/components/StatusBar";
  import type {
    AvailableModel,
    RegisteredExtensionSummary,
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
    emptyStateText?: string;
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
    isExtensionsLoading?: boolean;
    extensionsLoadError?: string | null;
    globalExtensions?: RegisteredExtensionSummary[];
    localExtensions?: RegisteredExtensionSummary[];
    extensionLoadDiagnostics?: Array<{ path: string; error: string }>;
    toolResultsCollapsedByDefault?: boolean;
    thinkingCollapsedByDefault?: boolean;
    showSidebar?: boolean;
    showSettingsButton?: boolean;
    showHeader?: boolean;
    windowTitleHint?: string | null;
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
    ontoolresultscollapsedchange?: (collapsed: boolean) => void | Promise<void>;
    onthinkingcollapsedchange?: (collapsed: boolean) => void | Promise<void>;
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
    emptyStateText = "Create a session to start chatting.",
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
    isExtensionsLoading = false,
    extensionsLoadError = null,
    globalExtensions = [],
    localExtensions = [],
    extensionLoadDiagnostics = [],
    toolResultsCollapsedByDefault = true,
    thinkingCollapsedByDefault = true,
    showSidebar = true,
    showSettingsButton = true,
    showHeader = true,
    windowTitleHint = null,
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
    onpromptinput,
    onpromptattachmentschange,
    onsubmit,
    oncancel,
    onslashcommand,
    onnewchat,
    onmodelchange,
    onthinkingchange,
    onmodelfilterchange,
    ontoolresultscollapsedchange,
    onthinkingcollapsedchange,
  }: Props = $props();

  let messagesContainerElement = $state<HTMLDivElement | null>(null);
  let settingsOpen = $state(false);

  $effect(() => {
    onmessagescontainerchange?.(messagesContainerElement);
  });

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function getToolResult(toolCallId: string) {
    return activeRuntime?.messages.getToolResult(toolCallId);
  }
</script>

<main class="relative flex w-full h-screen overflow-hidden">
  {#if showSidebar && onpopoutactivesession}
    <button
      type="button"
      class="absolute top-3 right-4 z-20 flex items-center justify-center h-9 w-9 rounded border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      onclick={onpopoutactivesession}
      disabled={!activeSession}
      aria-label="Open active session in floating window"
      title={activeSession
        ? "Open active session in floating window"
        : "No active session"}
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
  {/if}

  {#if showSidebar}
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
  {/if}

  <section
    class="relative flex-1 min-w-0 h-full flex items-stretch justify-center overflow-hidden"
  >
    {#if showSettingsButton}
      <button
        type="button"
        class={`absolute top-3 ${showSidebar ? "left-4" : "left-3"} z-40 flex items-center justify-center h-9 w-9 rounded border transition-colors ${
          settingsOpen
            ? "border-foreground bg-secondary text-foreground shadow-xs"
            : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary"
        }`}
        onclick={toggleSettings}
        aria-label={settingsOpen ? "Close settings" : "Open settings"}
        title={settingsOpen ? "Close settings" : "Open settings"}
        aria-expanded={settingsOpen}
      >
        <svg
          aria-hidden="true"
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.04-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.04 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9A1.7 1.7 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.04 4h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V8.4a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"
          />
        </svg>
      </button>
    {/if}

    <div
      class="flex flex-col w-full h-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] px-4"
      class:py-4={showHeader}
      class:pt-3={!showHeader}
      class:pb-4={!showHeader}
    >
      {#if showHeader}
        <header
          class="shrink-0 h-[86px] flex flex-col items-center justify-center text-center gap-1"
        >
          <h1
            class="text-3xl font-semibold tracking-tight bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent"
          >
            Graphone
          </h1>
          {#if windowTitleHint}
            <p class="text-xs text-muted-foreground">{windowTitleHint}</p>
          {/if}
        </header>
      {/if}

      <div
        class="flex-1 min-h-0 overflow-y-auto pr-4 flex flex-col gap-2 scroll-smooth [scrollbar-gutter:stable]"
        class:py-4={showHeader}
        class:pt-0={!showHeader}
        class:pb-4={!showHeader}
        class:pl-2={showHeader || !showSettingsButton}
        class:pl-10={showSettingsButton && !showHeader}
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
            <p class="text-muted-foreground text-sm">{emptyStateText}</p>
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
                defaultThinkingCollapsed={thinkingCollapsedByDefault}
                defaultToolCollapsed={toolResultsCollapsedByDefault}
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

    {#if settingsOpen}
      <SettingsOverlay
        {toolResultsCollapsedByDefault}
        {thinkingCollapsedByDefault}
        {isExtensionsLoading}
        {extensionsLoadError}
        {globalExtensions}
        {localExtensions}
        {extensionLoadDiagnostics}
        {ontoolresultscollapsedchange}
        {onthinkingcollapsedchange}
      />
    {/if}
  </section>
</main>
