<script lang="ts">
  import type { SessionDescriptor } from "$lib/stores/sessions.svelte";
  import type { SessionRuntime } from "$lib/types/session";
  import { cn } from "$lib/utils";

  interface Props {
    activeSession?: SessionDescriptor | null;
    activeRuntime?: SessionRuntime | null;
    showPopOutButton?: boolean;
    showSessionTreeButton?: boolean;
    showSettingsButton?: boolean;
    sessionTreeOpen?: boolean;
    settingsOpen?: boolean;
    onpopoutactivesession?: () => void | Promise<void>;
    onopensessiontree?: () => void | Promise<void>;
    onclosesessiontree?: () => void | Promise<void>;
    ontogglesettings?: () => void;
  }

  let {
    activeSession = null,
    activeRuntime = null,
    showPopOutButton = false,
    showSessionTreeButton = false,
    showSettingsButton = false,
    sessionTreeOpen = false,
    settingsOpen = false,
    onpopoutactivesession,
    onopensessiontree,
    onclosesessiontree,
    ontogglesettings,
  }: Props = $props();

  const shouldRender = $derived(
    showPopOutButton || showSessionTreeButton || showSettingsButton,
  );

  function toggleSessionTree(): void {
    if (sessionTreeOpen) {
      onclosesessiontree?.();
      return;
    }

    onopensessiontree?.();
  }
</script>

{#if shouldRender}
  <aside
    class="z-20 flex h-full w-16 shrink-0 border-l border-border bg-card/90"
    aria-label="Window actions"
  >
    <div
      class="flex h-full w-full flex-col items-center justify-between px-2 py-3"
    >
      <div class="flex w-full flex-col items-center gap-2">
        {#if showPopOutButton}
          <div
            class="group relative flex w-full justify-center overflow-visible"
          >
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
              class="pointer-events-none absolute right-full top-1/2 z-30 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-overlay px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block group-focus-within:block"
            >
              <span
                class="absolute left-full top-1/2 h-2.5 w-2.5 -translate-x-[1px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-overlay"
                aria-hidden="true"
              ></span>
              {activeSession
                ? "Open active session in floating window"
                : "No active session"}
            </div>
          </div>
        {/if}

        {#if showSessionTreeButton}
          <div
            class="group relative flex w-full justify-center overflow-visible"
          >
            <button
              type="button"
              class={cn(
                "flex h-9 w-9 items-center justify-center rounded border transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                sessionTreeOpen
                  ? "border-foreground bg-secondary text-foreground shadow-xs"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary",
              )}
              onclick={toggleSessionTree}
              disabled={!activeRuntime}
              aria-label={sessionTreeOpen
                ? "Close session tree"
                : "Open session tree"}
              aria-expanded={sessionTreeOpen}
            >
              <svg
                aria-hidden="true"
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M8 6h8"></path>
                <path d="M8 12h4"></path>
                <path d="M8 18h8"></path>
                <path d="M8 6v12"></path>
                <path d="M16 6v6"></path>
                <path d="M16 18v0"></path>
              </svg>
            </button>

            <div
              class="pointer-events-none absolute right-full top-1/2 z-30 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-overlay px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block group-focus-within:block"
            >
              <span
                class="absolute left-full top-1/2 h-2.5 w-2.5 -translate-x-[1px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-overlay"
                aria-hidden="true"
              ></span>
              {activeRuntime
                ? sessionTreeOpen
                  ? "Close session tree"
                  : "Open session tree"
                : "No active session"}
            </div>
          </div>
        {/if}
      </div>

      {#if showSettingsButton}
        <div class="group relative flex w-full justify-center overflow-visible">
          <button
            type="button"
            class={cn(
              "flex h-9 w-9 items-center justify-center rounded border transition-colors",
              settingsOpen
                ? "border-foreground bg-secondary text-foreground shadow-xs"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-secondary",
            )}
            onclick={ontogglesettings}
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
            class="pointer-events-none absolute right-full top-1/2 z-30 mr-3 hidden -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-overlay px-2 py-1 text-[11px] text-foreground shadow-lg group-hover:block group-focus-within:block"
          >
            <span
              class="absolute left-full top-1/2 h-2.5 w-2.5 -translate-x-[1px] -translate-y-1/2 rotate-45 border-r border-t border-border bg-overlay"
              aria-hidden="true"
            ></span>
            {settingsOpen ? "Close settings" : "Open settings"}
          </div>
        </div>
      {/if}
    </div>
  </aside>
{/if}
