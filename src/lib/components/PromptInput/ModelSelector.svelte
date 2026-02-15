<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { AvailableModel } from '$lib/stores/agent.svelte';
  import { scopedModelsStore } from '$lib/stores/scopedModels.svelte';

  type FilterMode = 'all' | 'active';

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

  const filteredModels = $derived(
    filterMode === 'active'
      ? models.filter((m) => scopedModelsStore.isScoped(m.provider, m.id))
      : models
  );

  const selectedIndex = $derived(
    filteredModels.findIndex(
      (model) => model.provider === currentProvider && model.id === currentModel
    )
  );

  const selectedValue = $derived(selectedIndex >= 0 ? String(selectedIndex) : '');
  const isDisabled = $derived(
    disabled || loading || changing || filteredModels.length === 0
  );
  const activeCount = $derived(scopedModelsStore.count);
  const currentModelIsScoped = $derived(
    currentProvider && currentModel
      ? scopedModelsStore.isScoped(currentProvider, currentModel)
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

  function toggleCurrentModel(): void {
    if (currentProvider && currentModel) {
      scopedModelsStore.toggle(currentProvider, currentModel);
    }
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
      isDisabled && 'opacity-60 cursor-not-allowed'
    )}
    value={selectedValue}
    disabled={isDisabled}
    onchange={handleChange}
    aria-label="Select model"
  >
    {#if loading}
      <option value="">Loading models...</option>
    {:else if filteredModels.length === 0}
      {#if filterMode === 'active' && activeCount === 0}
        <option value="">No active models</option>
      {:else if filterMode === 'active'}
        <option value="">No active models available</option>
      {:else}
        <option value="">No models available</option>
      {/if}
    {:else}
      {#if selectedIndex < 0}
        <option value="">Select model...</option>
      {/if}
      {#each filteredModels as model, index (`${model.provider}/${model.id}`)}
        {@const isScoped = scopedModelsStore.isScoped(model.provider, model.id)}
        <option value={String(index)}>
          {model.id}{isScoped ? ' ⭐' : ''} [{model.provider}]
        </option>
      {/each}
    {/if}
  </select>

  <!-- Toggle current model as active/inactive -->
  <button
    type="button"
    class={cn(
      'text-xs px-1 py-0.5 rounded border transition-colors',
      currentModelIsScoped
        ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-600 dark:text-yellow-400'
        : 'bg-transparent border-border text-muted-foreground hover:border-foreground hover:text-foreground',
      (!currentProvider || !currentModel || isDisabled) && 'opacity-40 cursor-not-allowed'
    )}
    onclick={toggleCurrentModel}
    disabled={!currentProvider || !currentModel || isDisabled}
    title={currentModelIsScoped ? 'Remove from active' : 'Add to active'}
  >
    {currentModelIsScoped ? '⭐' : '☆'}
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
        filterMode === 'active'
          ? 'bg-border text-foreground'
          : 'text-muted-foreground hover:text-foreground'
      )}
      onclick={() => handleFilterChange('active')}
      disabled={disabled || loading}
      title="Show active models only"
    >
      Active
      {#if activeCount > 0}
        <span class="text-[10px] bg-primary/20 px-1 rounded">{activeCount}</span>
      {/if}
    </button>
  </div>
</div>
