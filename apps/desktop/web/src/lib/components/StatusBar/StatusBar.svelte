<script lang="ts">
  import type { UsageIndicatorSnapshot } from "$lib/stores/agent.svelte";

  interface Props {
    cwd?: string | null;
    usageIndicator?: UsageIndicatorSnapshot | null;
  }

  let { cwd = null, usageIndicator = null }: Props = $props();

  const contextClass = $derived.by(() =>
    usageIndicator?.contextSeverity === "error"
      ? "text-destructive"
      : usageIndicator?.contextSeverity === "warning"
        ? "text-warning"
        : "text-muted-foreground/70",
  );
</script>

<div class="shrink-0 w-full px-2 pt-1 pb-2">
  <div
    class="w-full rounded-md border border-border/70 bg-foreground/[0.02] px-3 py-1.5"
  >
    <div class="flex items-center text-[11px] font-mono leading-tight">
      <span
        class="min-w-0 truncate text-muted-foreground/60"
        title={cwd ?? undefined}
      >
        {#if cwd}
          {cwd}
        {:else}
          No active session
        {/if}
      </span>
    </div>

    <div
      class="mt-0.5 text-[11px] font-mono leading-tight"
      title={usageIndicator?.fullText}
    >
      {#if usageIndicator}
        {#if usageIndicator.tokenStatsText}
          <span class="text-muted-foreground/70"
            >{usageIndicator.tokenStatsText}</span
          >
          <span class="text-muted-foreground/60"> </span>
        {/if}
        <span class={contextClass}>{usageIndicator.contextText}</span>
      {:else}
        <span class="text-muted-foreground/60">Usage unavailable</span>
      {/if}
    </div>
  </div>
</div>
