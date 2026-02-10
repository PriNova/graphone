<script lang="ts">
  import './PromptInput.css';
  
  interface Props {
    value?: string;
    onsubmit?: (value: string) => void | Promise<void>;
    oninput?: (value: string) => void;
    oncancel?: () => void;
    placeholder?: string;
    disabled?: boolean;
    autofocus?: boolean;
    isLoading?: boolean;
  }

  let {
    value: externalValue = '',
    onsubmit,
    oninput,
    oncancel,
    placeholder = 'Ask anything...',
    disabled = false,
    autofocus = false,
    isLoading = false,
  }: Props = $props();

  // Internal state for the input value
  // svelte-ignore state_referenced_locally
  let internalValue = $state(externalValue);

  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let isFocused = $state(false);
  
  const hasContent = $derived(internalValue.trim().length > 0);
  const canSubmit = $derived(hasContent && !disabled && !isLoading);

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    internalValue = target.value;
    oninput?.(internalValue);
    
    // Auto-resize textarea - preserve current height until we know new height
    const currentHeight = target.style.height;
    target.style.height = 'auto';
    const newHeight = Math.min(target.scrollHeight, 300);
    target.style.height = newHeight > 44 ? `${newHeight}px` : 'auto';
  }

  async function handleSubmit() {
    if (!canSubmit) return;
    
    const trimmedValue = internalValue.trim();
    if (!trimmedValue) return;
    
    await onsubmit?.(trimmedValue);
    
    // Clear input after submission
    internalValue = '';
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        handleSubmit();
      }
    } else if (event.key === 'Escape') {
      if (isLoading) {
        oncancel?.();
      } else {
        internalValue = '';
        if (textareaRef) {
          textareaRef.style.height = 'auto';
        }
      }
    }
  }

  // Auto-focus on mount if requested
  $effect(() => {
    if (autofocus && textareaRef) {
      textareaRef.focus();
    }
  });
</script>

<div class="prompt-input-container" class:focused={isFocused} class:loading={isLoading} class:disabled>
  <div class="prompt-input-wrapper">
    <textarea
      bind:this={textareaRef}
      bind:value={internalValue}
      {placeholder}
      {disabled}
      class="prompt-textarea"
      rows="1"
      oninput={handleInput}
      onkeydown={handleKeyDown}
      onfocus={() => isFocused = true}
      onblur={() => isFocused = false}
    ></textarea>
    
    <div class="prompt-actions">
      <button
        type="button"
        class="submit-button"
        class:active={hasContent}
        disabled={!canSubmit}
        onclick={handleSubmit}
        aria-label={isLoading ? 'Cancel' : 'Submit'}
      >
        {#if isLoading}
          <svg class="spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
  
  <div class="prompt-footer">
    <span class="hint">
      {#if isLoading}
        Press Escape to cancel
      {:else}
        Press Enter to submit, Shift+Enter for new line
      {/if}
    </span>
  </div>
</div>


