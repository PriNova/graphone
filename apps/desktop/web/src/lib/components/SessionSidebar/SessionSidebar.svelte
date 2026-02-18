<script lang="ts">
  import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
  import { cn } from "$lib/utils/cn";

  interface Props {
    projectScopes?: string[];
    activeProjectDir?: string | null;
    projectDirInput?: string;
    creating?: boolean;
    collapsed?: boolean;
    scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
    ontoggle?: () => void;
    oncreatesession?: () => void | Promise<void>;
    onselectscope?: (projectDir: string) => void | Promise<void>;
    onselecthistory?: (projectDir: string, history: PersistedSessionHistoryItem) => void | Promise<void>;
    onprojectdirinput?: (value: string) => void;
  }

  let {
    projectScopes = [],
    activeProjectDir = null,
    projectDirInput = "",
    creating = false,
    collapsed = false,
    scopeHistoryByProject = {},
    ontoggle,
    oncreatesession,
    onselectscope,
    onselecthistory,
    onprojectdirinput,
  }: Props = $props();

  function toScopeTitle(projectDir: string): string {
    const trimmed = projectDir.replace(/[\\/]+$/, "");
    const parts = trimmed.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] ?? projectDir;
  }

  function getScopeInitial(projectDir: string): string {
    const first = toScopeTitle(projectDir).trim().charAt(0);
    return first.length > 0 ? first.toUpperCase() : "?";
  }

  function getHistoryForScope(projectDir: string): PersistedSessionHistoryItem[] {
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

  async function handleHistorySelect(projectDir: string, history: PersistedSessionHistoryItem): Promise<void> {
    if (onselecthistory) {
      await onselecthistory(projectDir, history);
      return;
    }

    await onselectscope?.(projectDir);
  }

  function handleProjectDirInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    onprojectdirinput?.(target.value);
  }
</script>

<aside
  id="session-sidebar"
  class={cn(
    "h-full shrink-0 border-r border-border bg-card/40 backdrop-blur-xs flex flex-col transition-[width] duration-200",
    collapsed ? "w-16" : "w-80"
  )}
  aria-label="Project scopes"
>
  <div class="shrink-0 border-b border-border p-2">
    <div class="flex items-center justify-between gap-2">
      {#if !collapsed}
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-muted-foreground">Project Scope</p>
          <p class="text-sm font-medium truncate">{projectScopes.length} folder{projectScopes.length === 1 ? "" : "s"}</p>
        </div>
      {/if}

      <button
        type="button"
        class="inline-flex h-8 w-8 items-center justify-center rounded border border-border hover:bg-secondary"
        onclick={() => ontoggle?.()}
        aria-label={collapsed ? "Expand sessions sidebar" : "Collapse sessions sidebar"}
        aria-expanded={!collapsed}
        aria-controls="session-sidebar"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
        title="Create session"
        aria-label="Create session"
      >
        {creating ? "…" : "+"}
      </button>
    {/if}
  </div>

  <div class="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">
    {#if projectScopes.length === 0}
      {#if !collapsed}
        <p class="text-xs text-muted-foreground px-2 py-1">No project scopes discovered yet</p>
      {/if}
    {:else}
      {#each projectScopes as projectDir (projectDir)}
        {@const scopeHistory = getHistoryForScope(projectDir)}
        {#if collapsed}
          <button
            type="button"
            class={cn(
              "w-full h-10 rounded border text-sm font-medium border-border hover:bg-secondary",
              projectDir === activeProjectDir && "bg-secondary border-foreground"
            )}
            onclick={() => onselectscope?.(projectDir)}
            title={`${projectDir}${scopeHistory.length > 0 ? ` (${scopeHistory.length} stored)` : ""}`}
            aria-label={`Open ${toScopeTitle(projectDir)}`}
          >
            {getScopeInitial(projectDir)}
          </button>
        {:else}
          <div
            class={cn(
              "rounded border p-2 transition-colors hover:bg-secondary/40",
              projectDir === activeProjectDir ? "border-foreground/70 bg-secondary/60" : "border-border"
            )}
          >
            <button
              type="button"
              class={cn(
                "w-full text-left",
                projectDir === activeProjectDir && "text-foreground"
              )}
              onclick={() => onselectscope?.(projectDir)}
              aria-label={`Open ${toScopeTitle(projectDir)}`}
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">{toScopeTitle(projectDir)}</p>
                  <p class="text-xs text-muted-foreground truncate">{projectDir}</p>
                </div>
                {#if scopeHistory.length > 0}
                  <span class="text-[10px] px-1.5 py-0.5 rounded border border-border text-muted-foreground shrink-0">
                    {scopeHistory.length}
                  </span>
                {/if}
              </div>
            </button>

            {#if scopeHistory.length > 0}
              <div class="mt-2 ml-1 pl-2 border-l border-border/70 space-y-1">
                {#each scopeHistory.slice(0, 6) as history (history.filePath)}
                  <button
                    type="button"
                    class="w-full rounded border border-border/70 px-1.5 py-1 text-left text-[11px] hover:bg-secondary"
                    onclick={() => handleHistorySelect(projectDir, history)}
                    title={historyTooltipText(history)}
                    aria-label={`Open project scope ${toScopeTitle(projectDir)} from session ${history.sessionId}`}
                  >
                    <div class="flex items-center justify-between gap-2">
                      <div class="min-w-0 flex items-center gap-1.5">
                        <span class="font-mono text-[10px] text-muted-foreground shrink-0">
                          {history.source === "local" ? "L" : history.source === "global" ? "G" : "?"}
                        </span>
                        <span class="truncate">{historyPreviewText(history)}</span>
                      </div>
                      {#if history.timestamp}
                        <span class="text-muted-foreground shrink-0">{formatHistoryTimestamp(history.timestamp)}</span>
                      {/if}
                    </div>
                  </button>
                {/each}

                {#if scopeHistory.length > 6}
                  <p class="text-[11px] text-muted-foreground px-1.5">+{scopeHistory.length - 6} more sessions</p>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if !collapsed && activeProjectDir}
    <div class="shrink-0 border-t border-border p-2">
      <p class="text-[11px] uppercase tracking-wide text-muted-foreground">Active Scope</p>
      <p class="text-xs font-medium truncate">{toScopeTitle(activeProjectDir)}</p>
      <p class="text-xs text-muted-foreground truncate" title={activeProjectDir}>{activeProjectDir}</p>
    </div>
  {/if}
</aside>
