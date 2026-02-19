<script lang="ts">
  import type { ThinkingLevel } from "$lib/stores/agent.svelte";
  import DropdownSelect from "./DropdownSelect.svelte";

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

  const options = $derived<Array<{ key: string; label: string }>>(
    normalizedAvailableLevels.map((availableLevel) => ({
      key: availableLevel,
      label: availableLevel,
    })),
  );

  async function handleSelect(nextLevel: string): Promise<void> {
    const typedLevel = nextLevel as ThinkingLevel;

    if (!supportsThinking || typedLevel === currentLevel) {
      return;
    }

    await onchange?.(typedLevel);
  }
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Thinking:</span>

  {#if supportsThinking}
    <DropdownSelect
      {options}
      selectedKey={currentLevel}
      triggerLabel={currentLevel}
      disabled={isSelectDisabled}
      triggerClass="w-24"
      menuClass="w-28"
      align="right"
      minHeight={96}
      idealMaxHeight={220}
      ariaLabel="Select thinking level"
      listAriaLabel="Available thinking levels"
      title={changing ? "Updating thinking level..." : "Select thinking level"}
      onselect={handleSelect}
    />
  {:else}
    <span class="text-xs text-muted-foreground/70">off</span>
  {/if}
</div>
