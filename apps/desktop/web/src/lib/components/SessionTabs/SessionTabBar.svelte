<script lang="ts">
  import type { SessionTabView } from "$lib/session/session-tab-presentation";
  import { cn } from "$lib/utils/cn";

  interface Props {
    tabs?: SessionTabView[];
    activeSessionId?: string | null;
    emptyLabel?: string;
    onselect?: (sessionId: string) => void | Promise<void>;
    onclose?: (sessionId: string) => void | Promise<void>;
  }

  let {
    tabs = [],
    activeSessionId = null,
    emptyLabel = "No open sessions",
    onselect,
    onclose,
  }: Props = $props();

  let scrollContainer: HTMLDivElement | null = null;

  function handleClose(event: MouseEvent, sessionId: string): void {
    event.preventDefault();
    event.stopPropagation();
    void onclose?.(sessionId);
  }

  function tabContainerClass(isActive: boolean): string {
    return isActive
      ? "border-border bg-background text-foreground shadow-xs"
      : "border-transparent bg-surface text-muted-foreground hover:border-border hover:bg-surface-hover hover:text-foreground";
  }

  function closeButtonClass(isActive: boolean): string {
    return isActive
      ? "opacity-100"
      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  }

  function handleTabStripWheel(event: WheelEvent): void {
    if (!scrollContainer) {
      return;
    }

    const hasHorizontalOverflow =
      scrollContainer.scrollWidth > scrollContainer.clientWidth + 1;
    if (!hasHorizontalOverflow) {
      return;
    }

    const primaryDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;

    if (primaryDelta === 0) {
      return;
    }

    scrollContainer.scrollLeft += primaryDelta;
    event.preventDefault();
  }
</script>

<div class="relative w-full min-w-0 border-b border-border bg-background">
  <div
    bind:this={scrollContainer}
    class="tab-strip-scrollbar overflow-x-auto overflow-y-hidden bg-background pb-3 [scrollbar-gutter:stable]"
    onwheel={handleTabStripWheel}
  >
    <div
      class="flex min-w-max items-end gap-1 px-0.5"
      role="tablist"
      aria-label="Open sessions"
    >
      {#if tabs.length === 0}
        <div class="px-2 py-2.5 text-xs text-muted-foreground">
          {emptyLabel}
        </div>
      {/if}

      {#each tabs as tab (tab.sessionId)}
        <div
          class={cn(
            "group relative -mb-px flex h-10 min-w-[144px] max-w-[240px] shrink-0 items-center gap-1 rounded-t-lg border px-1.5 transition-[background-color,border-color,color,box-shadow]",
            tabContainerClass(activeSessionId === tab.sessionId),
          )}
          role="presentation"
        >
          {#if activeSessionId === tab.sessionId}
            <span
              class="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
              aria-hidden="true"
            ></span>
          {/if}

          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            role="tab"
            aria-selected={activeSessionId === tab.sessionId}
            aria-label={tab.accessibleLabel}
            onclick={() => onselect?.(tab.sessionId)}
          >
            <span
              class="flex h-4 w-4 shrink-0 items-center justify-center"
              aria-hidden="true"
            >
              {#if tab.isBusy}
                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              {:else if tab.needsReview}
                <span class="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
              {:else if tab.isDetached}
                <svg
                  class="h-3.5 w-3.5 text-muted-foreground"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <path d="M14 5h5v5"></path>
                  <path d="M10 14 19 5"></path>
                  <path d="M19 14v5h-5"></path>
                  <path d="M5 10V5h5"></path>
                  <path d="M5 5l5 5"></path>
                </svg>
              {/if}
            </span>

            <span class="truncate text-sm font-medium">{tab.label}</span>
          </button>

          {#if onclose}
            <button
              type="button"
              class={cn(
                "shrink-0 rounded-md p-1 text-muted-foreground transition-[opacity,background-color,color] hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                closeButtonClass(activeSessionId === tab.sessionId),
              )}
              aria-label={`Close ${tab.label}`}
              onclick={(event) => handleClose(event, tab.sessionId)}
              tabindex="-1"
            >
              <svg
                aria-hidden="true"
                class="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path d="M6 6l12 12"></path>
                <path d="M18 6 6 18"></path>
              </svg>
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
