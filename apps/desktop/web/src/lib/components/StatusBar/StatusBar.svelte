<script lang="ts">
  import type {
    ExtensionStatusEntry,
    UsageIndicatorSnapshot,
  } from "$lib/stores/agent.svelte";

  interface Props {
    cwd?: string | null;
    usageIndicator?: UsageIndicatorSnapshot | null;
    extensionStatuses?: ExtensionStatusEntry[];
  }

  let {
    cwd = null,
    usageIndicator = null,
    extensionStatuses = [],
  }: Props = $props();

  const contextClass = $derived.by(() =>
    usageIndicator?.contextSeverity === "error"
      ? "text-destructive"
      : usageIndicator?.contextSeverity === "warning"
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-muted-foreground",
  );

  const sortedExtensionStatuses = $derived.by(() =>
    [...extensionStatuses].sort((a, b) => a.key.localeCompare(b.key)),
  );
</script>

<div class="shrink-0 w-full px-2 pt-1 pb-2">
  <div class="w-full rounded-md border border-border bg-surface px-3 py-1.5">
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

    {#if sortedExtensionStatuses.length > 0}
      <div
        class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] font-mono leading-tight"
      >
        {#each sortedExtensionStatuses as status (status.key)}
          <span class="min-w-0 text-muted-foreground/80" title={status.text}>
            <span class="text-muted-foreground/50">{status.key}:</span>
            <span class="ml-1 text-foreground/85">{status.text}</span>
          </span>
        {/each}
      </div>
    {/if}
  </div>
</div>
