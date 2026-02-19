<script lang="ts">
  import { cn } from "$lib/utils/cn";
  import type { ThinkingLevel } from "$lib/stores/agent.svelte";

  const ORDERED_LEVELS: ThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ];

  interface Props {
    level?: ThinkingLevel;
    supportsThinking?: boolean;
    availableLevels?: ThinkingLevel[];
    changing?: boolean;
    disabled?: boolean;
    onchange?: (level: ThinkingLevel) => void | Promise<void>;
  }

  let {
    level = "off",
    supportsThinking = false,
    availableLevels = ["off"],
    changing = false,
    disabled = false,
    onchange,
  }: Props = $props();

  const normalizedAvailableLevels = $derived.by(() => {
    const fromState = ORDERED_LEVELS.filter((candidate) =>
      availableLevels.includes(candidate),
    );

    if (fromState.length > 0) {
      return fromState;
    }

    return ["off"] as ThinkingLevel[];
  });

  const currentLevel = $derived(
    normalizedAvailableLevels.includes(level)
      ? level
      : (normalizedAvailableLevels[0] ?? "off"),
  );

  const isSelectDisabled = $derived(
    disabled ||
      changing ||
      !supportsThinking ||
      normalizedAvailableLevels.length <= 1,
  );

  async function handleChange(event: Event): Promise<void> {
    const target = event.target as HTMLSelectElement;
    const nextLevel = target.value as ThinkingLevel;

    if (!supportsThinking || nextLevel === currentLevel) {
      return;
    }

    await onchange?.(nextLevel);
  }
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Thinking:</span>

  {#if supportsThinking}
    <select
      class={cn(
        "w-24 bg-input-background border border-border rounded px-2 py-0.5 text-xs text-foreground",
        "focus:outline-none focus:border-ring",
        isSelectDisabled && "opacity-60 cursor-not-allowed",
      )}
      value={currentLevel}
      onchange={handleChange}
      disabled={isSelectDisabled}
      aria-label="Select thinking level"
      title={changing ? "Updating thinking level..." : "Select thinking level"}
    >
      {#each normalizedAvailableLevels as availableLevel (availableLevel)}
        <option value={availableLevel}>{availableLevel}</option>
      {/each}
    </select>
  {:else}
    <span class="text-xs text-muted-foreground/70">off</span>
  {/if}
</div>
