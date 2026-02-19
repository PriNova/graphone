<script lang="ts">
  import { cn } from "$lib/utils/cn";
  import type { AvailableModel } from "$lib/stores/agent.svelte";
  import {
    enabledModelsStore as defaultEnabledModelsStore,
    type EnabledModelsStore,
  } from "$lib/stores/enabledModels.svelte";
  import DropdownSelect from "./DropdownSelect.svelte";

  type FilterMode = "all" | "enabled";

  interface Props {
    models?: AvailableModel[];
    currentModel?: string;
    currentProvider?: string;
    loading?: boolean;
    changing?: boolean;
    disabled?: boolean;
    enabledModels?: EnabledModelsStore;
    onchange?: (provider: string, modelId: string) => void | Promise<void>;
  }

  let {
    models = [],
    currentModel = "",
    currentProvider = "",
    loading = false,
    changing = false,
    disabled = false,
    enabledModels = defaultEnabledModelsStore,
    onchange,
  }: Props = $props();

  let filterMode = $state<FilterMode>("all");

  const hasEnabledScope = $derived(enabledModels.patterns.length > 0);
  const enabledKeys = $derived(enabledModels.resolveEnabledModelKeys(models));

  const enabledOnlyModels = $derived(
    models.filter((m) => enabledKeys.has(`${m.provider}/${m.id}`)),
  );

  const enabledCount = $derived(
    hasEnabledScope ? enabledOnlyModels.length : models.length,
  );

  const filteredModels = $derived(
    filterMode === "enabled" && hasEnabledScope ? enabledOnlyModels : models,
  );

  const selectedIndex = $derived(
    filteredModels.findIndex(
      (model) =>
        model.provider === currentProvider && model.id === currentModel,
    ),
  );

  const selectedModel = $derived(
    selectedIndex >= 0 ? filteredModels[selectedIndex] : null,
  );

  const selectedLabel = $derived.by(() => {
    if (loading) return "Loading models...";
    if (filteredModels.length === 0) {
      return filterMode === "enabled" && hasEnabledScope
        ? "No enabled models"
        : "No models available";
    }
    if (!selectedModel) return "Select model...";

    const key = `${selectedModel.provider}/${selectedModel.id}`;
    const isEnabled = hasEnabledScope && enabledKeys.has(key);
    return `${selectedModel.id}${isEnabled ? " ⭐" : ""} [${selectedModel.provider}]`;
  });

  const isSelectDisabled = $derived(
    disabled || loading || changing || filteredModels.length === 0,
  );

  const currentModelIsEnabled = $derived(
    hasEnabledScope && currentProvider && currentModel
      ? enabledKeys.has(`${currentProvider}/${currentModel}`)
      : false,
  );

  const options = $derived<Array<{ key: string; label: string }>>(
    filteredModels.map((model) => {
      const key = `${model.provider}\u0000${model.id}`;
      const isEnabled =
        hasEnabledScope && enabledKeys.has(`${model.provider}/${model.id}`);
      return {
        key,
        label: `${model.id}${isEnabled ? " ⭐" : ""} [${model.provider}]`,
      };
    }),
  );

  const optionModelMap = $derived.by(() => {
    const map = new Map<string, AvailableModel>();
    for (const model of filteredModels) {
      map.set(`${model.provider}\u0000${model.id}`, model);
    }
    return map;
  });

  const selectedKey = $derived(
    selectedModel ? `${selectedModel.provider}\u0000${selectedModel.id}` : "",
  );

  async function selectModel(model: AvailableModel): Promise<void> {
    if (model.provider === currentProvider && model.id === currentModel) {
      return;
    }

    await onchange?.(model.provider, model.id);
  }

  async function handleSelect(key: string): Promise<void> {
    const model = optionModelMap.get(key);
    if (!model) return;

    await selectModel(model);
  }

  async function toggleCurrentModel(): Promise<void> {
    if (!currentProvider || !currentModel) return;
    await enabledModels.toggleModel(currentProvider, currentModel, models);
  }

  function handleFilterChange(mode: FilterMode): void {
    filterMode = mode;
  }
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Model:</span>

  <DropdownSelect
    {options}
    {selectedKey}
    triggerLabel={selectedLabel}
    disabled={isSelectDisabled}
    triggerClass="w-60 text-left"
    menuClass="w-72"
    emptyText={filterMode === "enabled" && hasEnabledScope
      ? "No enabled models"
      : "No models available"}
    ariaLabel="Select model"
    listAriaLabel="Available models"
    onselect={handleSelect}
  />

  <!-- Toggle current model enabled/disabled (writes enabledModels in pi settings) -->
  <button
    type="button"
    class={cn(
      "text-xs px-1 py-0.5 rounded border transition-colors",
      currentModelIsEnabled
        ? "bg-yellow-500/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-400"
        : "bg-transparent border-border text-muted-foreground hover:border-foreground hover:text-foreground",
      (disabled || loading || changing || !currentProvider || !currentModel) &&
        "opacity-40 cursor-not-allowed",
    )}
    onclick={toggleCurrentModel}
    disabled={disabled ||
      loading ||
      changing ||
      !currentProvider ||
      !currentModel}
    title={hasEnabledScope
      ? currentModelIsEnabled
        ? "Remove from enabled models"
        : "Add to enabled models"
      : "All models currently enabled (click to start an enabled models list)"}
  >
    {currentModelIsEnabled ? "⭐" : "☆"}
  </button>

  <!-- Filter toggle -->
  <div
    class="flex items-center gap-0.5 bg-input-background border border-border rounded text-xs"
  >
    <button
      type="button"
      class={cn(
        "px-1.5 py-0.5 rounded transition-colors",
        filterMode === "all"
          ? "bg-border text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onclick={() => handleFilterChange("all")}
      disabled={disabled || loading}
      title="Show all models"
    >
      All
    </button>
    <button
      type="button"
      class={cn(
        "px-1.5 py-0.5 rounded transition-colors flex items-center gap-1",
        filterMode === "enabled"
          ? "bg-border text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      onclick={() => handleFilterChange("enabled")}
      disabled={disabled || loading}
      title={hasEnabledScope
        ? "Show enabled models only"
        : "Enabled models filter is not configured (shows all)"}
    >
      Enabled
      {#if hasEnabledScope}
        <span class="text-[10px] bg-primary/20 px-1 rounded"
          >{enabledCount}</span
        >
      {/if}
    </button>
  </div>
</div>
