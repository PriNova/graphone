<script lang="ts">
  import { cn } from "$lib/utils/cn";

  interface Props {
    command: string;
    output: string;
    exitCode?: number;
    cancelled: boolean;
    truncated: boolean;
    fullOutputPath?: string;
    excludeFromContext?: boolean;
    isStreaming?: boolean;
  }

  let {
    command,
    output,
    exitCode,
    cancelled,
    truncated,
    fullOutputPath,
    excludeFromContext = false,
    isStreaming = false,
  }: Props = $props();

  interface AutoScrollPayload {
    enabled: boolean;
    token: number;
  }

  function autoScrollToBottomOnUpdate(
    node: HTMLElement,
    payload: AutoScrollPayload,
  ) {
    const sync = (next: AutoScrollPayload) => {
      if (!next.enabled) {
        return;
      }

      requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
      });
    };

    sync(payload);

    return {
      update(nextPayload: AutoScrollPayload) {
        sync(nextPayload);
      },
    };
  }

  const hasOutput = $derived(output.length > 0);
  const statusLabel = $derived.by(() => {
    if (isStreaming) return "Running...";
    if (cancelled) return "Cancelled";
    if (typeof exitCode === "number") {
      return exitCode === 0 ? "Exit 0" : `Exit ${exitCode}`;
    }
    return "Done";
  });
</script>

<div class="flex w-full animate-fade-in justify-start">
  <div
    class="w-full bg-surface border border-border rounded-lg overflow-hidden wrap-break-word"
  >
    <div
      class="flex items-center gap-2 px-4 py-2 bg-surface-active border-b border-border text-xs uppercase tracking-wider text-muted-foreground font-semibold"
    >
      <span class="shrink-0">Bash</span>
      <span
        class="min-w-0 flex-1 normal-case font-normal tracking-normal text-foreground truncate"
      >
        {command}
      </span>
      <span
        class={cn(
          "shrink-0 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
          excludeFromContext
            ? "border-border text-muted-foreground"
            : "border-success/40 text-success",
        )}
      >
        {#if excludeFromContext}
          <svg
            class="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M3 3l18 18"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.58 10.58a2 2 0 002.83 2.83"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.88 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 7.5a11.8 11.8 0 01-4.04 5.19"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M6.61 6.61A10.93 10.93 0 001 11.5C2.73 15.89 7 19 12 19a10.94 10.94 0 004.24-.85"
            />
          </svg>
          <span>excluded from context</span>
        {:else}
          <svg
            class="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
            />
            <circle cx="12" cy="12" r="3" stroke-width="2" />
          </svg>
          <span>included in context</span>
        {/if}
      </span>
      <span
        class={cn(
          "shrink-0 normal-case",
          isStreaming && "text-muted-foreground",
          cancelled && "text-warning",
          typeof exitCode === "number" && exitCode !== 0 && "text-destructive",
        )}
      >
        {statusLabel}
      </span>
    </div>

    {#if hasOutput || isStreaming}
      <div
        class="max-h-75 overflow-y-auto"
        use:autoScrollToBottomOnUpdate={{
          enabled: isStreaming,
          token: output.length,
        }}
      >
        <pre
          class="p-4 m-0 font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre-wrap wrap-break-word">{output}</pre>
      </div>
    {:else}
      <div class="px-4 py-3 text-sm text-muted-foreground">(no output)</div>
    {/if}

    {#if !isStreaming && (truncated || fullOutputPath)}
      <div
        class="px-4 py-2 border-t border-border text-xs text-muted-foreground bg-surface"
      >
        {#if truncated}
          <span>Output truncated.</span>
        {/if}
        {#if fullOutputPath}
          <span class:ml-1={truncated}>Full output: {fullOutputPath}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>
