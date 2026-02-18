<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { cn } from '$lib/utils/cn';
  import type { AvailableModel } from '$lib/stores/agent.svelte';
  import {
    enabledModelsStore as defaultEnabledModelsStore,
    type EnabledModelsStore,
  } from '$lib/stores/enabledModels.svelte';

  type FilterMode = 'all' | 'enabled';
  type DropdownDirection = 'up' | 'down';

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
    currentModel = '',
    currentProvider = '',
    loading = false,
    changing = false,
    disabled = false,
    enabledModels = defaultEnabledModelsStore,
    onchange,
  }: Props = $props();

  let filterMode = $state<FilterMode>('all');
  let isOpen = $state(false);
  let dropdownDirection = $state<DropdownDirection>('up');
  let dropdownMaxHeight = $state(240);

  let containerEl = $state<HTMLDivElement | null>(null);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  const hasEnabledScope = $derived(enabledModels.patterns.length > 0);
  const enabledKeys = $derived(enabledModels.resolveEnabledModelKeys(models));

  const enabledOnlyModels = $derived(
    models.filter((m) => enabledKeys.has(`${m.provider}/${m.id}`))
  );

  const enabledCount = $derived(hasEnabledScope ? enabledOnlyModels.length : models.length);

  const filteredModels = $derived(
    filterMode === 'enabled' && hasEnabledScope ? enabledOnlyModels : models
  );

  const selectedIndex = $derived(
    filteredModels.findIndex(
      (model) => model.provider === currentProvider && model.id === currentModel
    )
  );

  const selectedModel = $derived(selectedIndex >= 0 ? filteredModels[selectedIndex] : null);

  const selectedLabel = $derived.by(() => {
    if (loading) return 'Loading models...';
    if (filteredModels.length === 0) {
      return filterMode === 'enabled' && hasEnabledScope ? 'No enabled models' : 'No models available';
    }
    if (!selectedModel) return 'Select model...';

    const key = `${selectedModel.provider}/${selectedModel.id}`;
    const isEnabled = hasEnabledScope && enabledKeys.has(key);
    return `${selectedModel.id}${isEnabled ? ' ⭐' : ''} [${selectedModel.provider}]`;
  });

  const isSelectDisabled = $derived(
    disabled || loading || changing || filteredModels.length === 0
  );

  const currentModelIsEnabled = $derived(
    hasEnabledScope && currentProvider && currentModel
      ? enabledKeys.has(`${currentProvider}/${currentModel}`)
      : false
  );

  function updateDropdownPlacement(): void {
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const minHeight = 120;
    const idealMaxHeight = 320;

    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);

    if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
      dropdownDirection = 'down';
      dropdownMaxHeight = Math.max(minHeight, Math.min(idealMaxHeight, spaceBelow));
    } else {
      dropdownDirection = 'up';
      dropdownMaxHeight = Math.max(minHeight, Math.min(idealMaxHeight, spaceAbove));
    }
  }

  async function openDropdown(): Promise<void> {
    if (isSelectDisabled) return;
    isOpen = true;
    await tick();
    updateDropdownPlacement();

    const selectedEl = dropdownEl?.querySelector<HTMLElement>('[data-selected="true"]');
    selectedEl?.scrollIntoView({ block: 'nearest' });
  }

  function closeDropdown(): void {
    isOpen = false;
  }

  async function toggleDropdown(): Promise<void> {
    if (isOpen) {
      closeDropdown();
      return;
    }
    await openDropdown();
  }

  async function selectModel(model: AvailableModel): Promise<void> {
    if (model.provider === currentProvider && model.id === currentModel) {
      closeDropdown();
      return;
    }

    await onchange?.(model.provider, model.id);
    closeDropdown();
  }

  async function toggleCurrentModel(): Promise<void> {
    if (!currentProvider || !currentModel) return;
    await enabledModels.toggleModel(currentProvider, currentModel, models);
  }

  function handleFilterChange(mode: FilterMode): void {
    filterMode = mode;
    if (isOpen) {
      tick().then(updateDropdownPlacement);
    }
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openDropdown();
    } else if (event.key === 'Escape') {
      closeDropdown();
    }
  }

  $effect(() => {
    if (isSelectDisabled && isOpen) {
      isOpen = false;
    }
  });

  onMount(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!isOpen || !containerEl) return;
      if (!containerEl.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    const handleWindowChange = (): void => {
      if (!isOpen) return;
      updateDropdownPlacement();
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleWindowChange);
    window.addEventListener('scroll', handleWindowChange, true);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleWindowChange);
      window.removeEventListener('scroll', handleWindowChange, true);
      document.removeEventListener('keydown', handleEscape);
    };
  });
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Model:</span>

  <div class="relative" bind:this={containerEl}>
    <button
      type="button"
      class={cn(
        'w-60 text-left bg-input-background border border-border rounded px-2 py-0.5 text-xs text-foreground',
        'focus:outline-none focus:border-ring',
        'inline-flex items-center justify-between gap-2',
        isSelectDisabled && 'opacity-60 cursor-not-allowed'
      )}
      onclick={toggleDropdown}
      onkeydown={handleTriggerKeydown}
      disabled={isSelectDisabled}
      aria-label="Select model"
      aria-haspopup="listbox"
      aria-expanded={isOpen}
    >
      <span class="truncate">{selectedLabel}</span>
      <svg
        class={cn('h-3 w-3 shrink-0 transition-transform', isOpen && 'rotate-180')}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>

    {#if isOpen}
      <div
        bind:this={dropdownEl}
        class={cn(
          'absolute left-0 z-50 w-72 bg-input-background text-foreground border border-border rounded-md shadow-lg overflow-y-auto',
          dropdownDirection === 'down' ? 'top-full mt-1' : 'bottom-full mb-1'
        )}
        style={`max-height: ${dropdownMaxHeight}px;`}
        role="listbox"
        aria-label="Available models"
      >
        {#if filteredModels.length === 0}
          <div class="px-2 py-1.5 text-xs text-muted-foreground">
            {filterMode === 'enabled' && hasEnabledScope ? 'No enabled models' : 'No models available'}
          </div>
        {:else}
          {#each filteredModels as model (`${model.provider}/${model.id}`)}
            {@const key = `${model.provider}/${model.id}`}
            {@const isEnabled = hasEnabledScope && enabledKeys.has(key)}
            {@const isSelected = model.provider === currentProvider && model.id === currentModel}
            <button
              type="button"
              class={cn(
                'w-full px-2 py-1.5 text-left text-xs text-foreground hover:bg-secondary',
                isSelected && 'bg-accent'
              )}
              data-selected={isSelected}
              onclick={() => selectModel(model)}
            >
              {model.id}{isEnabled ? ' ⭐' : ''} [{model.provider}]
            </button>
          {/each}
        {/if}
      </div>
    {/if}
  </div>

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
