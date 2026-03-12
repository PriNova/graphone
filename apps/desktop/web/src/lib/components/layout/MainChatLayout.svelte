<script lang="ts">
  import {
    AssistantMessage,
    BashExecutionMessage,
    UserMessage,
  } from "$lib/components/Messages";
  import SettingsOverlay from "$lib/components/layout/SettingsOverlay.svelte";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import { SessionTabBar } from "$lib/components/SessionTabs";
  import { StatusBar } from "$lib/components/StatusBar";
  import type { SessionTabView } from "$lib/session/session-tab-presentation";
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
  import type { UiTheme } from "$lib/theme/app-theme";

  interface Props {
    projectScopes?: string[];
    scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
    activeProjectDir?: string | null;
    activeSessionId?: string | null;
    activeSessionFile?: string | null;
    busySessionIds?: string[];
    busySessionFiles?: string[];
    reviewSessionIds?: string[];
    reviewSessionFiles?: string[];
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
    theme?: UiTheme;
    toolResultsCollapsedByDefault?: boolean;
    thinkingCollapsedByDefault?: boolean;
    showSidebar?: boolean;
    showSettingsButton?: boolean;
    showHeader?: boolean;
    sessionTabs?: SessionTabView[];
    windowTitleHint?: string | null;
    onselectsessiontab?: (sessionId: string) => void | Promise<void>;
    onclosesessiontab?: (sessionId: string) => void | Promise<void>;
    onmessagescroll?: () => void;
    onmessagescontainerchange?: (element: HTMLDivElement | null) => void;
    onmessagescontentchange?: (element: HTMLDivElement | null) => void;
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
    onthemechange?: (theme: UiTheme) => void | Promise<void>;
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
    reviewSessionIds = [],
    reviewSessionFiles = [],
    projectDirInput = "",
    sessionsCreating = false,
    sidebarCollapsed = false,
    collapsedScopes = [],
    activeSession = null,
    startupError = null,
    emptyStateText = "Select a project scope or enter a project directory to start chatting.",
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
    theme = "dark",
    toolResultsCollapsedByDefault = true,
    thinkingCollapsedByDefault = true,
    showSidebar = true,
    showSettingsButton = true,
    showHeader = true,
    sessionTabs = undefined,
    windowTitleHint = null,
    onmessagescroll,
    onmessagescontainerchange,
    onmessagescontentchange,
    onselectsessiontab,
    onclosesessiontab,
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
    onthemechange,
    ontoolresultscollapsedchange,
    onthinkingcollapsedchange,
  }: Props = $props();

  let messagesContainerElement = $state<HTMLDivElement | null>(null);
  let messagesContentElement = $state<HTMLDivElement | null>(null);
  let settingsOpen = $state(false);

  $effect(() => {
    onmessagescontainerchange?.(messagesContainerElement);
  });

  $effect(() => {
    onmessagescontentchange?.(messagesContentElement);
  });

  function toggleSettings(): void {
    settingsOpen = !settingsOpen;
  }

  function getToolResult(toolCallId: string) {
    return activeRuntime?.messages.getToolResult(toolCallId);
  }

  function isToolPending(toolCallId: string): boolean {
    return activeRuntime?.messages.isToolCallPending(toolCallId) ?? false;
  }

  const emptyChatPromptText = $derived.by(() => {
    const missingProviderSetup =
      activeRuntime &&
      sessionStarted &&
      !isModelsLoading &&
      availableModels.length === 0 &&
      currentModel.trim().length === 0 &&
      currentProvider.trim().length === 0;

    if (!missingProviderSetup) {
      return "Start a conversation by typing below";
    }

    return "Start a conversation by typing below. No models are available yet — add a provider API key in ~/.pi/agent/auth.json (or via environment variables), or run /login first.";
  });
</script>

<main class="relative flex w-full h-screen overflow-hidden">
  {#if showSidebar && onpopoutactivesession}
    <div class="group absolute top-3 right-4 z-20">
      <button
        type="button"
        class="flex h-9 w-9 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-foreground hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        onclick={onpopoutactivesession}
        disabled={!activeSession}
        aria-label="Open active session in floating window"
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

      <div
        class="pointer-events-none absolute top-full right-0 z-30 mt-2 hidden whitespace-nowrap rounded-md border border-border bg-overlay px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block group-focus-within:block"
      >
        {activeSession
          ? "Open active session in floating window"
          : "No active session"}
      </div>
    </div>
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
      {reviewSessionIds}
      {reviewSessionFiles}
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
      <div
        class={`group absolute top-3 ${showSidebar ? "left-4" : "left-3"} z-40`}
      >
        <button
          type="button"
          class={`flex h-9 w-9 items-center justify-center rounded border transition-colors ${
            settingsOpen
              ? "border-foreground bg-secondary text-foreground shadow-xs"
              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary"
          }`}
          onclick={toggleSettings}
          aria-label={settingsOpen ? "Close settings" : "Open settings"}
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

        <div
          class="pointer-events-none absolute top-full left-1/2 z-30 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-overlay px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block group-focus-within:block"
        >
          {settingsOpen ? "Close settings" : "Open settings"}
        </div>
      </div>
    {/if}

    <div
      class="flex flex-col w-full h-full px-4"
      class:py-4={showHeader}
      class:pt-3={!showHeader}
      class:pb-4={!showHeader}
    >
      {#if showHeader}
        {#if sessionTabs}
          <div
            class="w-full pr-6 lg:pr-8"
            class:pl-2={showHeader || !showSettingsButton}
            class:pl-10={showSettingsButton && !showHeader}
          >
            <div
              class="w-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] mx-auto"
            >
              <header class="shrink-0 pt-12 pb-3">
                <div
                  class="mb-3 flex flex-col items-center justify-center text-center gap-1"
                >
                  <h1
                    class="text-3xl font-semibold tracking-tight text-foreground"
                  >
                    Graphone
                  </h1>
                  {#if windowTitleHint}
                    <p
                      class="max-w-full truncate text-xs text-muted-foreground"
                    >
                      {windowTitleHint}
                    </p>
                  {/if}
                </div>
                <SessionTabBar
                  tabs={sessionTabs}
                  {activeSessionId}
                  emptyLabel="No open sessions"
                  onselect={onselectsessiontab}
                  onclose={onclosesessiontab}
                />
              </header>
            </div>
          </div>
        {:else}
          <div
            class="w-full pr-6 lg:pr-8"
            class:pl-2={showHeader || !showSettingsButton}
            class:pl-10={showSettingsButton && !showHeader}
          >
            <div
              class="w-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] mx-auto"
            >
              <header
                class="shrink-0 h-[86px] flex flex-col items-center justify-center text-center gap-1"
              >
                <h1
                  class="text-3xl font-semibold tracking-tight text-foreground"
                >
                  Graphone
                </h1>
                {#if windowTitleHint}
                  <p class="text-xs text-muted-foreground">{windowTitleHint}</p>
                {/if}
              </header>
            </div>
          </div>
        {/if}
      {/if}

      <div
        class="flex-1 min-h-0 overflow-y-auto pr-6 lg:pr-8 flex flex-col [scrollbar-gutter:stable]"
        class:py-4={showHeader}
        class:pt-0={!showHeader}
        class:pb-4={!showHeader}
        class:pl-2={showHeader || !showSettingsButton}
        class:pl-10={showSettingsButton && !showHeader}
        bind:this={messagesContainerElement}
        onscroll={onmessagescroll}
      >
        <div
          class="min-h-full w-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] mx-auto"
          bind:this={messagesContentElement}
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
                {emptyChatPromptText}
              </p>
            </div>
          {:else}
            {#each messages as message, messageIndex (message.id)}
              <div class:mt-2={messageIndex > 0}>
                {#if message.type === "user"}
                  <UserMessage
                    content={message.content}
                    timestamp={message.timestamp}
                  />
                {:else if message.type === "bashExecution"}
                  <BashExecutionMessage
                    command={message.command}
                    output={message.output}
                    exitCode={message.exitCode}
                    cancelled={message.cancelled}
                    truncated={message.truncated}
                    fullOutputPath={message.fullOutputPath}
                    excludeFromContext={message.excludeFromContext}
                    isStreaming={message.isStreaming}
                  />
                {:else}
                  <AssistantMessage
                    content={message.content}
                    timestamp={message.timestamp}
                    isStreaming={message.isStreaming}
                    defaultThinkingCollapsed={thinkingCollapsedByDefault}
                    defaultToolCollapsed={toolResultsCollapsedByDefault}
                    {getToolResult}
                    {isToolPending}
                  />
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      </div>

      <section
        class="shrink-0 w-full pb-1 pt-1 pr-6 lg:pr-8"
        class:pl-2={showHeader || !showSettingsButton}
        class:pl-10={showSettingsButton && !showHeader}
      >
        <div
          class="w-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] mx-auto"
        >
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
        </div>
      </section>

      <div
        class="w-full pr-6 lg:pr-8"
        class:pl-2={showHeader || !showSettingsButton}
        class:pl-10={showSettingsButton && !showHeader}
      >
        <div
          class="w-full max-w-[min(95vw,1200px)] lg:max-w-[min(88vw,1360px)] mx-auto"
        >
          <StatusBar cwd={activeProjectDir} {usageIndicator} />
        </div>
      </div>
    </div>

    {#if settingsOpen}
      <SettingsOverlay
        {theme}
        {toolResultsCollapsedByDefault}
        {thinkingCollapsedByDefault}
        {isExtensionsLoading}
        {extensionsLoadError}
        {globalExtensions}
        {localExtensions}
        {extensionLoadDiagnostics}
        {onthemechange}
        {ontoolresultscollapsedchange}
        {onthinkingcollapsedchange}
      />
    {/if}
  </section>
</main>
