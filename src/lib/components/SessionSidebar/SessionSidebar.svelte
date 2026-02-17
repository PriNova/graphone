<script lang="ts">
  import type { SessionDescriptor } from "$lib/stores/sessions.svelte";
  import { cn } from "$lib/utils/cn";

  interface Props {
    sessions?: SessionDescriptor[];
    activeSessionId?: string | null;
    projectDirInput?: string;
    creating?: boolean;
    collapsed?: boolean;
    ontoggle?: () => void;
    oncreatesession?: () => void | Promise<void>;
    onselectsession?: (sessionId: string) => void;
    onclosesession?: (sessionId: string) => void | Promise<void>;
    onprojectdirinput?: (value: string) => void;
  }

  let {
    sessions = [],
    activeSessionId = null,
    projectDirInput = "",
    creating = false,
    collapsed = false,
    ontoggle,
    oncreatesession,
    onselectsession,
    onclosesession,
    onprojectdirinput,
  }: Props = $props();

  const activeSession = $derived(sessions.find((session) => session.sessionId === activeSessionId) ?? null);

  function getSessionInitial(title: string): string {
    const first = title.trim().charAt(0);
    return first.length > 0 ? first.toUpperCase() : "?";
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
  aria-label="Project sessions"
>
  <div class="shrink-0 border-b border-border p-2">
    <div class="flex items-center justify-between gap-2">
      {#if !collapsed}
        <div class="min-w-0">
          <p class="text-xs uppercase tracking-wide text-muted-foreground">Project Scope</p>
          <p class="text-sm font-medium truncate">{sessions.length} session{sessions.length === 1 ? "" : "s"}</p>
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
    {#if sessions.length === 0}
      {#if !collapsed}
        <p class="text-xs text-muted-foreground px-2 py-1">No active sessions</p>
      {/if}
    {:else}
      {#each sessions as session (session.sessionId)}
        {#if collapsed}
          <button
            type="button"
            class={cn(
              "w-full h-10 rounded border text-sm font-medium border-border hover:bg-secondary",
              session.sessionId === activeSessionId && "bg-secondary border-foreground"
            )}
            onclick={() => onselectsession?.(session.sessionId)}
            title={`${session.title} — ${session.projectDir}`}
            aria-label={`Switch to ${session.title}`}
          >
            {getSessionInitial(session.title)}
          </button>
        {:else}
          <div
            class={cn(
              "group flex items-start gap-2 rounded border p-2 transition-colors",
              session.sessionId === activeSessionId
                ? "border-foreground/70 bg-secondary"
                : "border-border hover:bg-secondary/70"
            )}
          >
            <button
              type="button"
              class="flex-1 min-w-0 text-left"
              onclick={() => onselectsession?.(session.sessionId)}
              aria-label={`Switch to ${session.title}`}
            >
              <p class="text-sm font-medium truncate">{session.title}</p>
              <p class="text-xs text-muted-foreground truncate">{session.projectDir}</p>
            </button>
            <button
              type="button"
              class="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded border border-border opacity-70 hover:opacity-100 hover:bg-destructive/10"
              onclick={() => onclosesession?.(session.sessionId)}
              aria-label={`Close ${session.title}`}
            >
              ×
            </button>
          </div>
        {/if}
      {/each}
    {/if}
  </div>

  {#if !collapsed && activeSession}
    <div class="shrink-0 border-t border-border p-2">
      <p class="text-[11px] uppercase tracking-wide text-muted-foreground">Active Scope</p>
      <p class="text-xs font-medium truncate">{activeSession.title}</p>
      <p class="text-xs text-muted-foreground truncate" title={activeSession.projectDir}>{activeSession.projectDir}</p>
    </div>
  {/if}
</aside>
