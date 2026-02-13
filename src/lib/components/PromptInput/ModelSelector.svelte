<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { AvailableModel } from '$lib/stores/agent.svelte';

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

  const selectedIndex = $derived.by(() =>
    models.findIndex((model) => model.provider === currentProvider && model.id === currentModel)
  );

  const selectedValue = $derived(selectedIndex >= 0 ? String(selectedIndex) : '');
  const isDisabled = $derived(disabled || loading || changing || models.length === 0);

  async function handleChange(event: Event): Promise<void> {
    const target = event.target as HTMLSelectElement;
    if (!target.value) return;

    const index = Number.parseInt(target.value, 10);
    if (!Number.isInteger(index) || index < 0 || index >= models.length) {
      return;
    }

    const next = models[index];
    if (!next) return;
    if (next.provider === currentProvider && next.id === currentModel) return;

    await onchange?.(next.provider, next.id);
  }
</script>

<div class="flex items-center gap-1.5">
  <span class="text-muted-foreground/60">Model:</span>
  <select
    class={cn(
      'max-w-70 bg-input-background border border-border rounded px-2 py-0.5 text-xs text-foreground',
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
    {:else if models.length === 0}
      <option value="">No models available</option>
    {:else}
      {#if selectedIndex < 0}
        <option value="">Select model...</option>
      {/if}
      {#each models as model, index (`${model.provider}/${model.id}`)}
        <option value={String(index)}>{model.id} [{model.provider}]</option>
      {/each}
    {/if}
  </select>
</div>
