<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { AvailableModel } from '$lib/stores/agent.svelte';
  import { enabledModelsStore } from '$lib/stores/enabledModels.svelte';

  type FilterMode = 'all' | 'enabled';

  interface Props {
    models?: AvailableModel[];
    currentModel?: string;
    currentProvider?: string;
    loading?: boolean;
    changing?: boolean;
    disabled?: boolean;
    onchange?: (provider: string, modelId: string) => void | Promise<void>;
  }

  let {
    models = [],
    currentModel = '',
    currentProvider = '',
    loading = false,
    changing = false,
    disabled = false,
    onchange,
  }: Props = $props();

  let filterMode = $state<FilterMode>('all');

  const hasEnabledScope = $derived(enabledModelsStore.patterns.length > 0);
  const enabledKeys = $derived(enabledModelsStore.resolveEnabledModelKeys(models));

  const enabledModels = $derived(
    models.filter((m) => enabledKeys.has(`${m.provider}/${m.id}`))
  );

  const enabledCount = $derived(hasEnabledScope ? enabledModels.length : models.length);

  const filteredModels = $derived(
    filterMode === 'enabled' && hasEnabledScope ? enabledModels : models
  );

  const selectedIndex = $derived(
    filteredModels.findIndex(
      (model) => model.provider === currentProvider && model.id === currentModel
    )
  );

  const selectedValue = $derived(selectedIndex >= 0 ? String(selectedIndex) : '');
  const isSelectDisabled = $derived(
    disabled || loading || changing || filteredModels.length === 0
  );

  const currentModelIsEnabled = $derived(
    hasEnabledScope && currentProvider && currentModel
      ? enabledKeys.has(`${currentProvider}/${currentModel}`)
      : false
  );

  async function handleChange(event: Event): Promise<void> {
    const target = event.target as HTMLSelectElement;
    if (!target.value) return;

    const index = Number.parseInt(target.value, 10);
    if (!Number.isInteger(index) || index < 0 || index >= filteredModels.length) {
      return;
    }

    const next = filteredModels[index];
    if (!next) return;
    if (next.provider === currentProvider && next.id === currentModel) return;

    await onchange?.(next.provider, next.id);
  }

  async function toggleCurrentModel(): Promise<void> {
    if (!currentProvider || !currentModel) return;
    // Pass the full (unfiltered) model list so we can expand patterns into explicit IDs if needed.
    await enabledModelsStore.toggleModel(currentProvider, currentModel, models);
  }

  function handleFilterChange(mode: FilterMode): void {
    filterMode = mode;
  }
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Model:</span>
  <select
    class={cn(
      'max-w-60 bg-input-background border border-border rounded px-2 py-0.5 text-xs text-foreground',
      'focus:outline-none focus:border-ring',
      '[&::-ms-expand]:hidden',
      isSelectDisabled && 'opacity-60 cursor-not-allowed'
    )}
    value={selectedValue}
    disabled={isSelectDisabled}
    onchange={handleChange}
    aria-label="Select model"
  >
    {#if loading}
      <option value="">Loading models...</option>
    {:else if filteredModels.length === 0}
      {#if filterMode === 'enabled' && hasEnabledScope}
        <option value="">No enabled models</option>
      {:else}
        <option value="">No models available</option>
      {/if}
    {:else}
      {#if selectedIndex < 0}
        <option value="">Select model...</option>
      {/if}
      {#each filteredModels as model, index (`${model.provider}/${model.id}`)}
        {@const key = `${model.provider}/${model.id}`}
        {@const isEnabled = hasEnabledScope && enabledKeys.has(key)}
        <option value={String(index)}>
          {model.id}{isEnabled ? ' ⭐' : ''} [{model.provider}]
        </option>
      {/each}
    {/if}
  </select>

  <!-- Toggle current model enabled/disabled (writes enabledModels in pi settings) -->
  <button
    type="button"
    class={cn(
      'text-xs px-1 py-0.5 rounded border transition-colors',
      currentModelIsEnabled
        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-400'
        : 'bg-transparent border-border text-muted-foreground hover:border-foreground hover:text-foreground',
      (disabled || loading || changing || !currentProvider || !currentModel) && 'opacity-40 cursor-not-allowed'
    )}
    onclick={toggleCurrentModel}
    disabled={disabled || loading || changing || !currentProvider || !currentModel}
    title={
      hasEnabledScope
        ? currentModelIsEnabled
          ? 'Remove from enabled models'
          : 'Add to enabled models'
        : 'All models currently enabled (click to start an enabled models list)'
    }
  >
    {currentModelIsEnabled ? '⭐' : '☆'}
  </button>

  <!-- Filter toggle -->
  <div class="flex items-center gap-0.5 bg-input-background border border-border rounded text-xs">
    <button
      type="button"
      class={cn(
        'px-1.5 py-0.5 rounded transition-colors',
        filterMode === 'all'
          ? 'bg-border text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onclick={() => handleFilterChange('all')}
      disabled={disabled || loading}
      title="Show all models"
    >
      All
    </button>
    <button
      type="button"
      class={cn(
        'px-1.5 py-0.5 rounded transition-colors flex items-center gap-1',
        filterMode === 'enabled'
          ? 'bg-border text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onclick={() => handleFilterChange('enabled')}
      disabled={disabled || loading}
      title={hasEnabledScope ? 'Show enabled models only' : 'Enabled models filter is not configured (shows all)'}
    >
      Enabled
      {#if hasEnabledScope}
        <span class="text-[10px] bg-primary/20 px-1 rounded">{enabledCount}</span>
      {/if}
    </button>
  </div>
</div>
