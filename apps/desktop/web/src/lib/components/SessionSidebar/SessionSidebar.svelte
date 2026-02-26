<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
  import { cn } from "$lib/utils/cn";

  interface Props {
    projectScopes?: string[];
    activeProjectDir?: string | null;
    activeSessionId?: string | null;
    activeSessionFile?: string | null;
    projectDirInput?: string;
    creating?: boolean;
    collapsed?: boolean;
    scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
    collapsedScopes?: string[];
    ontoggle?: () => void;
    oncreatesession?: () => void | Promise<void>;
    onselectscope?: (projectDir: string) => void | Promise<void>;
    onselecthistory?: (
      projectDir: string,
      history: PersistedSessionHistoryItem,
    ) => void | Promise<void>;
    onremovehistory?: (
      projectDir: string,
      history: PersistedSessionHistoryItem,
    ) => void | Promise<void>;
    onprojectdirinput?: (value: string) => void;
    onremovescope?: (projectDir: string) => void | Promise<void>;
    ontogglescopecollapse?: (projectDir: string) => void;
  }

  let {
    projectScopes = [],
    activeProjectDir = null,
    activeSessionId = null,
    activeSessionFile = null,
    projectDirInput = "",
    creating = false,
    collapsed = false,
    scopeHistoryByProject = {},
    collapsedScopes = [],
    ontoggle,
    oncreatesession,
    onselectscope,
    onselecthistory,
    onremovehistory,
    onprojectdirinput,
    onremovescope,
    ontogglescopecollapse,
  }: Props = $props();

  // Local UI state for pending deletion and expanded session lists
  // (not persisted - these are transient UI states)
  const pendingDeletionScopes = new SvelteSet<string>();
  const pendingDeletionHistory = new SvelteSet<string>();
  const expandedSessionLists = new SvelteSet<string>();

  let historyTooltip = $state<{
    visible: boolean;
    text: string;
    x: number;
    y: number;
  }>({
    visible: false,
    text: "",
    x: 0,
    y: 0,
  });

  function toggleScopeCollapse(projectDir: string, event: MouseEvent): void {
    event.stopPropagation();
    ontogglescopecollapse?.(projectDir);
  }

  function toggleSessionListExpand(
    projectDir: string,
    event: MouseEvent,
  ): void {
    event.stopPropagation();
    if (expandedSessionLists.has(projectDir)) {
      expandedSessionLists.delete(projectDir);
    } else {
      expandedSessionLists.add(projectDir);
    }
  }

  function isScopeCollapsed(projectDir: string): boolean {
    return collapsedScopes.includes(projectDir);
  }

  function toScopeTitle(projectDir: string): string {
    const trimmed = projectDir.replace(/[\\/]+$/, "");
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? projectDir;
  }

  function getScopeInitial(projectDir: string): string {
    const first = toScopeTitle(projectDir).trim().charAt(0);
    return first.length > 0 ? first.toUpperCase() : "?";
  }

  function getHistoryForScope(
    projectDir: string,
  ): PersistedSessionHistoryItem[] {
    return scopeHistoryByProject[projectDir] ?? [];
  }

  function formatHistoryTimestamp(timestamp?: string): string {
    if (!timestamp) {
      return "";
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }

    return parsed.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function shortSessionId(sessionId: string): string {
    const trimmed = sessionId.trim();
    return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed;
  }

  function historyPreviewText(history: PersistedSessionHistoryItem): string {
    const message = history.firstUserMessage?.trim();
    if (message && message.length > 0) {
      return message;
    }

    return `Session ${shortSessionId(history.sessionId)}`;
  }

  function historyTooltipText(history: PersistedSessionHistoryItem): string {
    const message = history.firstUserMessage?.trim();
    if (message && message.length > 0) {
      return message;
    }

    return history.sessionId;
  }

  function isHistoryActive(history: PersistedSessionHistoryItem): boolean {
    const normalizedActiveFile = activeSessionFile?.trim() ?? "";
    if (normalizedActiveFile.length > 0) {
      return normalizedActiveFile === history.filePath.trim();
    }

    const normalizedActiveSessionId = activeSessionId?.trim() ?? "";
    return (
      normalizedActiveSessionId.length > 0 &&
      normalizedActiveSessionId === history.sessionId.trim()
    );
  }

  function showHistoryTooltip(
    event: MouseEvent | FocusEvent,
    text: string,
  ): void {
    const normalized = text.trim();
    if (normalized.length === 0) return;

    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const margin = 8;
    const maxTooltipWidth = Math.min(
      420,
      Math.max(220, window.innerWidth - margin * 2),
    );
    const x = Math.max(
      margin,
      Math.min(rect.left, window.innerWidth - maxTooltipWidth - margin),
    );
    const y = Math.max(
      margin,
      Math.min(rect.bottom + margin, window.innerHeight - 40),
    );

    historyTooltip = {
      visible: true,
      text: normalized,
      x,
      y,
    };
  }

  function hideHistoryTooltip(): void {
    historyTooltip.visible = false;
  }

  async function handleHistorySelect(
    projectDir: string,
    history: PersistedSessionHistoryItem,
  ): Promise<void> {
    hideHistoryTooltip();

    if (onselecthistory) {
      await onselecthistory(projectDir, history);
      return;
    }

    await onselectscope?.(projectDir);
  }

  function historyDeletionKey(history: PersistedSessionHistoryItem): string {
    return history.filePath.trim();
  }

  function startDeleteHistory(
    history: PersistedSessionHistoryItem,
    event: MouseEvent,
  ): void {
    event.stopPropagation();
    pendingDeletionHistory.add(historyDeletionKey(history));
  }

  function cancelDeleteHistory(
    history: PersistedSessionHistoryItem,
    event: MouseEvent,
  ): void {
    event.stopPropagation();
    pendingDeletionHistory.delete(historyDeletionKey(history));
  }

  async function confirmDeleteHistory(
    projectDir: string,
    history: PersistedSessionHistoryItem,
    event: MouseEvent,
  ): Promise<void> {
    event.stopPropagation();
    pendingDeletionHistory.delete(historyDeletionKey(history));
    await onremovehistory?.(projectDir, history);
  }

  function isPendingHistoryDeletion(
    history: PersistedSessionHistoryItem,
  ): boolean {
    return pendingDeletionHistory.has(historyDeletionKey(history));
  }

  function handleProjectDirInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    onprojectdirinput?.(target.value);
  }

  function startDeleteScope(projectDir: string, event: MouseEvent): void {
    event.stopPropagation();
    pendingDeletionScopes.add(projectDir);
  }

  function cancelDeleteScope(projectDir: string, event: MouseEvent): void {
    event.stopPropagation();
    pendingDeletionScopes.delete(projectDir);
  }

  async function confirmDeleteScope(
    projectDir: string,
    event: MouseEvent,
  ): Promise<void> {
    event.stopPropagation();
    pendingDeletionScopes.delete(projectDir);
    await onremovescope?.(projectDir);
  }

  function isPendingDeletion(projectDir: string): boolean {
    return pendingDeletionScopes.has(projectDir);
  }

  function scopeTooltipText(
    projectDir: string,
    scopeHistoryCount: number,
  ): string {
    return `${projectDir}${scopeHistoryCount > 0 ? ` (${scopeHistoryCount} stored)` : ""}`;
  }
</script>

<aside
  id="session-sidebar"
  class={cn(
    "h-full shrink-0 border-r border-border bg-card/40 backdrop-blur-xs flex flex-col transition-[width] duration-200",
    collapsed ? "w-16" : "w-80",
  )}
  aria-label="Project scopes"
>
  <div class="shrink-0 border-b border-border p-2">
    <div class="flex items-center justify-between gap-2">
      {#if !collapsed}
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-muted-foreground">
            Project Scope
          </p>
          <p class="text-sm font-medium truncate">
            {projectScopes.length} folder{projectScopes.length === 1 ? "" : "s"}
          </p>
        </div>
      {/if}

      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded border border-border hover:bg-secondary"
        onclick={() => ontoggle?.()}
        aria-label={collapsed
          ? "Expand sessions sidebar"
          : "Collapse sessions sidebar"}
        aria-expanded={!collapsed}
        aria-controls="session-sidebar"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
    </div>

    {#if !collapsed}
      <div class="mt-2 flex items-center gap-2">
        <input
          value={projectDirInput}
          class="flex-1 bg-input-background border border-border rounded px-2 py-1.5 text-xs"
          placeholder="Project directory"
          oninput={handleProjectDirInput}
        />
        <button
          type="button"
          class="px-2 py-1.5 text-xs border border-border rounded hover:bg-secondary disabled:opacity-50"
          onclick={() => oncreatesession?.()}
          disabled={creating}
        >
          {creating ? "…" : "+"}
        </button>
      </div>
    {:else}
      <button
        type="button"
        class="mt-2 inline-flex h-8 w-full items-center justify-center rounded border border-border text-sm hover:bg-secondary disabled:opacity-50"
        onclick={() => oncreatesession?.()}
        disabled={creating}
        onmouseenter={(event) => showHistoryTooltip(event, "Create session")}
        onmouseleave={hideHistoryTooltip}
        onfocus={(event) => showHistoryTooltip(event, "Create session")}
        onblur={hideHistoryTooltip}
        aria-label="Create session"
      >
        {creating ? "…" : "+"}
      </button>
    {/if}
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
    {#if projectScopes.length === 0}
      {#if !collapsed}
        <p class="text-xs text-muted-foreground px-2 py-1">
          No project scopes discovered yet
        </p>
      {/if}
    {:else}
      {#each projectScopes as projectDir (projectDir)}
        {@const scopeHistory = getHistoryForScope(projectDir)}
        {@const scopeIsCollapsed = isScopeCollapsed(projectDir)}
        {#if collapsed}
          <button
            type="button"
            class={cn(
              "w-full h-10 rounded border text-sm font-medium border-border hover:bg-secondary",
              projectDir === activeProjectDir &&
                "bg-secondary border-foreground",
            )}
            onclick={() => onselectscope?.(projectDir)}
            onmouseenter={(event) =>
              showHistoryTooltip(
                event,
                scopeTooltipText(projectDir, scopeHistory.length),
              )}
            onmouseleave={hideHistoryTooltip}
            onfocus={(event) =>
              showHistoryTooltip(
                event,
                scopeTooltipText(projectDir, scopeHistory.length),
              )}
            onblur={hideHistoryTooltip}
            aria-label={`Open ${toScopeTitle(projectDir)}`}
          >
            {getScopeInitial(projectDir)}
          </button>
        {:else}
          <div
            class={cn(
              "rounded border transition-colors hover:bg-secondary/40 group",
              projectDir === activeProjectDir
                ? "border-foreground/70 bg-secondary/60"
                : "border-border",
            )}
          >
            <!-- Scope header row -->
            <div class="flex items-center gap-1 p-2">
              <!-- Chevron toggle (only shown when there is history) -->
              {#if scopeHistory.length > 0}
                <button
                  type="button"
                  class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary"
                  onclick={(e) => toggleScopeCollapse(projectDir, e)}
                  aria-label={scopeIsCollapsed
                    ? `Expand ${toScopeTitle(projectDir)} history`
                    : `Collapse ${toScopeTitle(projectDir)} history`}
                  aria-expanded={!scopeIsCollapsed}
                >
                  <svg
                    class={cn(
                      "h-3 w-3 transition-transform duration-150",
                      scopeIsCollapsed ? "-rotate-90" : "rotate-0",
                    )}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              {:else}
                <!-- Spacer so title aligns with scopes that have history -->
                <span class="shrink-0 w-5"></span>
              {/if}

              <!-- Scope title / select button -->
              <button
                type="button"
                class={cn(
                  "min-w-0 flex-1 text-left",
                  projectDir === activeProjectDir && "text-foreground",
                )}
                onclick={() => onselectscope?.(projectDir)}
                aria-label={`Open ${toScopeTitle(projectDir)}`}
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm font-medium truncate">
                      {toScopeTitle(projectDir)}
                    </p>
                    <p class="text-xs text-muted-foreground truncate">
                      {projectDir}
                    </p>
                  </div>
                  {#if scopeHistory.length > 0}
                    <span
                      class="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0"
                    >
                      {scopeHistory.length}
                    </span>
                  {/if}
                </div>
              </button>

              <!-- Delete button / confirmation -->
              {#if onremovescope}
                {#if isPendingDeletion(projectDir)}
                  <div class="shrink-0 flex items-center gap-1">
                    <span class="text-[10px] text-muted-foreground"
                      >Delete?</span
                    >
                    <button
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-success hover:bg-success/10"
                      onclick={(e) => confirmDeleteScope(projectDir, e)}
                      aria-label="Confirm delete"
                      title="Confirm delete"
                    >
                      <svg
                        class="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary"
                      onclick={(e) => cancelDeleteScope(projectDir, e)}
                      aria-label="Cancel delete"
                      title="Cancel"
                    >
                      <svg
                        class="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                      >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                    </button>
                  </div>
                {:else}
                  <button
                    type="button"
                    class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                    onclick={(e) => startDeleteScope(projectDir, e)}
                    aria-label="Delete scope"
                    title="Delete scope"
                  >
                    <svg
                      class="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path
                        d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                      ></path>
                    </svg>
                  </button>
                {/if}
              {/if}
            </div>

            <!-- History list (hidden when scope is collapsed) -->
            {#if scopeHistory.length > 0 && !scopeIsCollapsed}
              {@const showAllSessions = expandedSessionLists.has(projectDir)}
              {@const displayedHistory = showAllSessions
                ? scopeHistory
                : scopeHistory.slice(0, 6)}
              <div
                class="px-2 pb-2 ml-6 pl-2 border-l border-border/70 space-y-1"
              >
                {#each displayedHistory as history (history.filePath)}
                  <div
                    class={cn(
                      "w-full rounded border px-1.5 py-1 text-left text-[11px] transition-colors group/session",
                      isHistoryActive(history)
                        ? "border-foreground/70 bg-secondary text-foreground"
                        : "border-border/70 hover:bg-secondary",
                    )}
                  >
                    <div class="flex items-center gap-2">
                      <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        onclick={() => handleHistorySelect(projectDir, history)}
                        onmouseenter={(event) =>
                          showHistoryTooltip(
                            event,
                            historyTooltipText(history),
                          )}
                        onmouseleave={hideHistoryTooltip}
                        onfocus={(event) =>
                          showHistoryTooltip(
                            event,
                            historyTooltipText(history),
                          )}
                        onblur={hideHistoryTooltip}
                        aria-current={isHistoryActive(history)
                          ? "true"
                          : undefined}
                        aria-label={`Open project scope ${toScopeTitle(projectDir)} from session ${history.sessionId}`}
                      >
                        <div class="flex items-center justify-between gap-2">
                          <div class="min-w-0 flex items-center gap-1.5">
                            <span
                              class="font-mono text-[10px] text-muted-foreground shrink-0"
                            >
                              {history.source === "local"
                                ? "L"
                                : history.source === "global"
                                  ? "G"
                                  : "?"}
                            </span>
                            <span class="truncate"
                              >{historyPreviewText(history)}</span
                            >
                          </div>
                          {#if history.timestamp}
                            <span class="text-muted-foreground shrink-0"
                              >{formatHistoryTimestamp(history.timestamp)}</span
                            >
                          {/if}
                        </div>
                      </button>

                      {#if onremovehistory}
                        {#if isPendingHistoryDeletion(history)}
                          <div class="shrink-0 flex items-center gap-1">
                            <span class="text-[10px] text-muted-foreground"
                              >Delete?</span
                            >
                            <button
                              type="button"
                              class="inline-flex h-5 w-5 items-center justify-center rounded text-success hover:bg-success/10"
                              onclick={(e) =>
                                confirmDeleteHistory(projectDir, history, e)}
                              aria-label="Confirm delete session"
                              title="Confirm delete"
                            >
                              <svg
                                class="h-3 w-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                              >
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </button>
                            <button
                              type="button"
                              class="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary"
                              onclick={(e) => cancelDeleteHistory(history, e)}
                              aria-label="Cancel delete session"
                              title="Cancel"
                            >
                              <svg
                                class="h-3 w-3"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2.5"
                              >
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                              </svg>
                            </button>
                          </div>
                        {:else}
                          <button
                            type="button"
                            class="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/session:opacity-100 transition-opacity"
                            onclick={(e) => startDeleteHistory(history, e)}
                            aria-label="Delete session"
                            title="Delete session"
                          >
                            <svg
                              class="h-3 w-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              stroke-width="2"
                            >
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path
                                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                              ></path>
                            </svg>
                          </button>
                        {/if}
                      {/if}
                    </div>
                  </div>
                {/each}

                {#if scopeHistory.length > 6}
                  <button
                    type="button"
                    class="w-full text-left text-[11px] text-muted-foreground hover:text-foreground px-1.5 py-0.5 transition-colors"
                    onclick={(e) => toggleSessionListExpand(projectDir, e)}
                    aria-label={showAllSessions
                      ? "Show fewer sessions"
                      : `Show all ${scopeHistory.length} sessions`}
                    aria-expanded={showAllSessions}
                  >
                    {showAllSessions
                      ? "Show less"
                      : `Show all (${scopeHistory.length})`}
                  </button>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if historyTooltip.visible}
    <div
      class="fixed z-50 pointer-events-none px-2 py-1 rounded border border-border bg-input-background text-foreground text-[11px] shadow-xl whitespace-pre-wrap wrap-break-word"
      style={`left: ${historyTooltip.x}px; top: ${historyTooltip.y}px; max-width: min(420px, calc(100vw - 16px));`}
      role="tooltip"
    >
      {historyTooltip.text}
    </div>
  {/if}
</aside>
