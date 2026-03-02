<script lang="ts">
  import { CompactActivityRail } from "$lib/components/Messages";
  import { PromptInput } from "$lib/components/PromptInput";
  import { SessionSidebar } from "$lib/components/SessionSidebar";
  import type { AvailableModel, ThinkingLevel } from "$lib/stores/agent.svelte";
  import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
  import type { PromptImageAttachment } from "$lib/types/agent";
  import type { SessionRuntime } from "$lib/types/session";

  export type CompactActivityItem =
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

  interface Props {
    isCompactSessionWindow?: boolean;
    sessionsBootstrapped?: boolean;
    compactSessionMissing?: boolean;
    projectScopes?: string[];
    scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
    activeProjectDir?: string | null;
    activeSessionId?: string | null;
    activeSessionFile?: string | null;
    busySessionIds?: string[];
    busySessionFiles?: string[];
    projectDirInput?: string;
    sessionsCreating?: boolean;
    collapsedScopes?: string[];
    compactScopesSidebarOpen?: boolean;
    compactScopeTooltip?: string;
    showCompactActivityRailShell?: boolean;
    showCompactActivityRail?: boolean;
    compactRailViewportClass?: string;
    compactActivityItems?: CompactActivityItem[];
    isStreaming?: boolean;
    activeRuntime?: SessionRuntime | null;
    sessionStarted?: boolean;
    activePromptDraft?: string;
    activePromptAttachmentDraft?: PromptImageAttachment[];
    isLoading?: boolean;
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
    onclosewindow?: () => void | Promise<void>;
    onopenmainwindow?: () => void | Promise<void>;
    ontogglecompactscopes?: () => void;
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
    oncompactdraghandlemousedown?: (event: MouseEvent) => void | Promise<void>;
    oncompactresizehandlemousedown?: (
      event: MouseEvent,
      direction: "West" | "East",
    ) => void | Promise<void>;
    onenterfullmode?: () => void | Promise<void>;
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
    isCompactSessionWindow = false,
    sessionsBootstrapped = false,
    compactSessionMissing = false,
    projectScopes = [],
    scopeHistoryByProject = {},
    activeProjectDir = null,
    activeSessionId = null,
    activeSessionFile = null,
    busySessionIds = [],
    busySessionFiles = [],
    projectDirInput = "",
    sessionsCreating = false,
    collapsedScopes = [],
    compactScopesSidebarOpen = false,
    compactScopeTooltip = "",
    showCompactActivityRailShell = false,
    showCompactActivityRail = false,
    compactRailViewportClass = "",
    compactActivityItems = [],
    isStreaming = false,
    activeRuntime = null,
    sessionStarted = false,
    activePromptDraft = "",
    activePromptAttachmentDraft = [],
    isLoading = false,
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
    onclosewindow,
    onopenmainwindow,
    ontogglecompactscopes,
    onprojectdirinput,
    oncreatesession,
    onselectscope,
    onselecthistory,
    onopenhistorywindow,
    onremovehistory,
    onremovescope,
    ontogglescopecollapse,
    oncompactdraghandlemousedown,
    oncompactresizehandlemousedown,
    onenterfullmode,
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
</script>

<main class="h-screen w-full overflow-hidden bg-transparent">
  {#if isCompactSessionWindow && sessionsBootstrapped && compactSessionMissing}
    <section class="flex h-full w-full items-center justify-center p-3">
      <div
        class="w-full max-w-sm rounded-2xl border-[2px] border-[rgba(255,255,255,0.92)] bg-background p-4"
      >
        <p class="text-sm font-medium text-foreground">Session not found</p>
        <p class="mt-1 text-xs text-muted-foreground">
          This compact session is no longer available.
        </p>
        <div class="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            class="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-secondary"
            onclick={onclosewindow}
          >
            Close window
          </button>
          <button
            type="button"
            class="rounded border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-foreground hover:text-foreground hover:bg-secondary"
            onclick={onopenmainwindow}
          >
            Open main window
          </button>
        </div>
      </div>
    </section>
  {:else}
    <section
      class="grid h-full w-full grid-rows-[minmax(0,1fr)_auto] gap-1 px-1 py-1"
    >
      <div class="relative flex min-h-0 flex-col justify-end overflow-hidden">
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

        {#if !isCompactSessionWindow}
          <div
            id="compact-session-sidebar"
            class={`absolute inset-0 z-20 flex items-end transition-[opacity,transform] duration-200 ${
              compactScopesSidebarOpen
                ? "pointer-events-auto opacity-100 translate-y-0"
                : "pointer-events-none opacity-0 translate-y-2"
            }`}
            aria-hidden={!compactScopesSidebarOpen}
          >
            <div
              class={`h-full max-h-[440px] min-h-0 w-full overflow-hidden rounded-2xl border-[2px] border-[rgba(255,255,255,0.92)] bg-background ${
                compactScopesSidebarOpen
                  ? "pointer-events-auto"
                  : "pointer-events-none"
              }`}
            >
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
                collapsed={false}
                {collapsedScopes}
                ontoggle={ontogglecompactscopes}
                {onprojectdirinput}
                {oncreatesession}
                {onselectscope}
                {onselecthistory}
                {onopenhistorywindow}
                {onremovehistory}
                {onremovescope}
                {ontogglescopecollapse}
              />
            </div>
          </div>
        {/if}
      </div>

      <div class="relative w-full">
        <button
          type="button"
          class="absolute left-0 top-1/2 z-10 h-10 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 opacity-70 transition-opacity hover:opacity-100 active:opacity-100 cursor-ew-resize"
          onmousedown={(event) =>
            oncompactresizehandlemousedown?.(event, "West")}
          aria-label="Resize compact width from left edge"
          title="Resize width"
        ></button>

        <div
          class="flex items-center gap-2 w-full rounded-[999px] border-[3px] border-[rgba(255,255,255,0.92)] bg-background px-2 py-0.5"
        >
          <button
            type="button"
            class="shrink-0 h-9 w-9 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary cursor-move select-none"
            data-tauri-drag-region
            onmousedown={oncompactdraghandlemousedown}
            aria-label="Move window"
            title="Move window"
          >
            <span data-tauri-drag-region class="text-base leading-none">⋮</span>
          </button>

          {#if !isCompactSessionWindow}
            <button
              type="button"
              class={`shrink-0 flex items-center justify-center h-9 w-9 rounded-full border text-sm font-semibold transition-colors ${
                compactScopesSidebarOpen
                  ? "border-foreground bg-secondary text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary"
              }`}
              onclick={ontogglecompactscopes}
              aria-label={compactScopesSidebarOpen
                ? "Hide project scopes"
                : "Show project scopes"}
              aria-expanded={compactScopesSidebarOpen}
              aria-controls="compact-session-sidebar"
              title={compactScopeTooltip}
            >
              P
            </button>
          {/if}

          <div class="flex-1 min-w-0">
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
              compact={true}
            />
          </div>

          {#if isCompactSessionWindow}
            <button
              type="button"
              class="shrink-0 flex items-center justify-center h-9 rounded-full border border-border px-3 text-xs text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors"
              onclick={onclosewindow}
              aria-label="Close compact window"
              title="Close compact window"
            >
              Close
            </button>
          {:else}
            <button
              type="button"
              class="shrink-0 flex items-center justify-center h-9 w-9 rounded-full border border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary transition-colors"
              onclick={onenterfullmode}
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
          {/if}
        </div>

        <button
          type="button"
          class="absolute right-0 top-1/2 z-10 h-10 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-white/45 opacity-70 transition-opacity hover:opacity-100 active:opacity-100 cursor-ew-resize"
          onmousedown={(event) =>
            oncompactresizehandlemousedown?.(event, "East")}
          aria-label="Resize compact width from right edge"
          title="Resize width"
        ></button>
      </div>
    </section>
  {/if}
</main>
