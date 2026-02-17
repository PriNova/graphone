<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import { parseSlashCommand, isKnownSlashCommand, ALL_SLASH_COMMANDS, getCommandHandler } from '$lib/slash-commands';
  import ModelSelector from './ModelSelector.svelte';
  import type { AvailableModel } from '$lib/stores/agent.svelte';
  import type { EnabledModelsStore } from '$lib/stores/enabledModels.svelte';
  
  interface Props {
    value?: string;
    onsubmit?: (value: string) => void | Promise<void>;
    oninput?: (value: string) => void;
    oncancel?: () => void;
    onslashcommand?: (command: string, args: string, fullText: string) => void | Promise<void>;
    onmodelchange?: (provider: string, modelId: string) => void | Promise<void>;
    placeholder?: string;
    disabled?: boolean;
    autofocus?: boolean;
    isLoading?: boolean;
    model?: string;
    provider?: string;
    models?: AvailableModel[];
    modelsLoading?: boolean;
    modelChanging?: boolean;
    enabledModels?: EnabledModelsStore;
    cwd?: string | null;
    cwdLoading?: boolean;
  }

  let {
    value: externalValue = '',
    onsubmit,
    oninput,
    oncancel,
    onslashcommand,
    onmodelchange,
    placeholder = 'Ask anything...',
    disabled = false,
    autofocus = false,
    isLoading = false,
    model = '',
    provider = '',
    models = [],
    modelsLoading = false,
    modelChanging = false,
    enabledModels,
    cwd = null,
    cwdLoading = false,
  }: Props = $props();

  // Internal state for the input value
  // svelte-ignore state_referenced_locally
  let internalValue = $state(externalValue);

  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let isFocused = $state(false);
  let commandJustSelected = $state(false);
  
  const hasContent = $derived(internalValue.trim().length > 0);
  const canSubmit = $derived(hasContent && !disabled && !isLoading);
  const canCancel = $derived(isLoading);
  const modelSelectorDisabled = $derived(disabled || isLoading || modelChanging);

  // Slash command detection
  const parsedCommand = $derived(parseSlashCommand(internalValue));
  const isSlashCommand = $derived(parsedCommand !== null);
  const isKnownCommand = $derived(parsedCommand ? isKnownSlashCommand(parsedCommand.command) : false);
  const commandHandler = $derived(parsedCommand ? getCommandHandler(parsedCommand.command) : null);
  
  // Filter matching commands for autocomplete (show all matches, scrollable)
  const matchingCommands = $derived.by(() => {
    if (!isFocused || !isSlashCommand) return [];
    if (!parsedCommand || parsedCommand.args) return [];
    // Don't show dropdown if input ends with space (command is complete/selected)
    if (internalValue.endsWith(' ')) return [];
    // Don't show dropdown immediately after selecting a command
    if (commandJustSelected) return [];
    const query = parsedCommand.command.toLowerCase();
    return ALL_SLASH_COMMANDS
      .filter(cmd => cmd.name.toLowerCase().startsWith(query));
  });

  // Track selected command index for keyboard navigation
  let selectedCommandIndex = $state(0);
  
  // Reset selection when matching commands change
  $effect(() => {
    if (matchingCommands.length > 0) {
      selectedCommandIndex = 0;
    }
  });

  function selectCommand(cmd: typeof ALL_SLASH_COMMANDS[0]) {
    // Set flag to prevent dropdown from reopening immediately
    commandJustSelected = true;
    // Update value with trailing space to prevent dropdown from reopening
    internalValue = `/${cmd.name} `;
    oninput?.(internalValue);
    // Re-focus textarea
    textareaRef?.focus();
    // Clear the flag after a short delay to allow future slash commands
    setTimeout(() => {
      commandJustSelected = false;
    }, 100);
  }

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
    
    // Check if this is a slash command
    const slashCmd = parseSlashCommand(trimmedValue);
    if (slashCmd && onslashcommand) {
      await onslashcommand(slashCmd.command, slashCmd.args, trimmedValue);
    } else {
      await onsubmit?.(trimmedValue);
    }
    
    // Clear input after submission
    internalValue = '';
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    // Handle dropdown navigation when slash command dropdown is open
    if (matchingCommands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        selectedCommandIndex = (selectedCommandIndex + 1) % matchingCommands.length;
        return;
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        selectedCommandIndex = (selectedCommandIndex - 1 + matchingCommands.length) % matchingCommands.length;
        return;
      } else if (event.key === 'Enter' && !event.shiftKey) {
        // Select the highlighted command
        event.preventDefault();
        const selectedCmd = matchingCommands[selectedCommandIndex];
        if (selectedCmd) {
          selectCommand(selectedCmd);
        }
        return;
      } else if (event.key === 'Escape') {
        // Close dropdown but keep typing
        event.preventDefault();
        isFocused = false;
        return;
      }
    }

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

<div 
  class={cn(
    "flex flex-col w-full mx-auto relative",
    disabled && "opacity-60 cursor-not-allowed"
  )}
>
  <!-- Slash command autocomplete dropdown -->
  {#if matchingCommands.length > 0}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div 
      class="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-md shadow-lg max-h-64 overflow-y-auto z-50"
      onmousedown={(e) => e.preventDefault()}
    >
      {#each matchingCommands as cmd, index (cmd.name)}
        <button
          type="button"
          class={cn(
            "flex items-center gap-2 px-3 py-2 w-full text-left cursor-pointer",
            index === selectedCommandIndex && "bg-accent"
          )}
          onmouseenter={() => selectedCommandIndex = index}
          onclick={() => selectCommand(cmd)}
        >
          <span class="text-sm font-medium text-primary">/{cmd.name}</span>
          <span class="text-sm text-muted-foreground">{cmd.description}</span>
        </button>
      {/each}
    </div>
  {:else if isSlashCommand && isFocused && parsedCommand && !parsedCommand.args && matchingCommands.length === 0 && !internalValue.endsWith(' ')}
    <!-- No matches indicator -->
    <div class="absolute bottom-full left-0 mb-1 px-2 py-1 bg-background border border-border rounded-md shadow-lg">
      <span class="text-xs text-warning">/{parsedCommand.command}</span>
      <span class="text-xs text-muted-foreground ml-2">Unknown command</span>
    </div>
  {/if}

  <div 
    class={cn(
      "flex flex-col w-full bg-foreground/[0.03] border border-input-border rounded-md transition-all duration-100 overflow-hidden relative",
      isFocused && "bg-foreground/[0.04] border-ring",
      isSlashCommand && isKnownCommand && commandHandler === 'local' && "border-success/50",
      isSlashCommand && isKnownCommand && commandHandler === 'unimplemented' && "border-warning/50",
      isSlashCommand && !isKnownCommand && "border-destructive/50",
      isLoading && "animate-pulse"
    )}
  >
    <textarea
      bind:this={textareaRef}
      bind:value={internalValue}
      {placeholder}
      {disabled}
      class={cn(
        "w-full min-h-[44px] max-h-[40vh] py-3 px-4 pr-12 bg-transparent border-none outline-none resize-none text-foreground overflow-y-auto text-base leading-normal",
        "placeholder:text-muted-foreground/60",
        disabled && "cursor-not-allowed"
      )}
      rows="1"
      oninput={handleInput}
      onkeydown={handleKeyDown}
      onfocus={() => isFocused = true}
      onblur={() => isFocused = false}
    ></textarea>
    
    <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
      <button
        type="button"
        class={cn(
          "flex items-center justify-center w-8 h-8 p-0 rounded cursor-pointer transition-all duration-150",
          isLoading 
            ? "bg-destructive border-destructive text-destructive-foreground hover:bg-destructive/90" 
            : "bg-transparent border border-border text-muted-foreground hover:not-disabled:bg-secondary hover:not-disabled:border-foreground hover:not-disabled:text-foreground",
          !isLoading && hasContent && "bg-primary border-primary text-primary-foreground hover:not-disabled:opacity-90",
          !canSubmit && !canCancel && "opacity-40 cursor-not-allowed"
        )}
        disabled={!canSubmit && !canCancel}
        onclick={isLoading ? () => oncancel?.() : handleSubmit}
        aria-label={isLoading ? 'Stop' : 'Submit'}
      >
        {#if isLoading}
          <!-- Stop square icon -->
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <rect x="6" y="6" width="12" height="12" rx="1" />
          </svg>
        {:else}
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
  
  <div class="flex justify-between pt-1.5 px-1">
    <span class="text-xs flex flex-col gap-0.5">
      {#if isSlashCommand}
        {#if isKnownCommand}
          {#if commandHandler === 'local'}
            <span class="text-success font-medium">/{parsedCommand?.command}</span>
            <span class="text-muted-foreground ml-1">
              {ALL_SLASH_COMMANDS.find(c => c.name === parsedCommand?.command)?.description}
            </span>
          {:else if commandHandler === 'unimplemented'}
            <span class="text-warning font-medium">/{parsedCommand?.command}</span>
            <span class="text-muted-foreground ml-1">
              Not yet implemented • {ALL_SLASH_COMMANDS.find(c => c.name === parsedCommand?.command)?.description}
            </span>
          {:else}
            <span class="text-primary font-medium">/{parsedCommand?.command}</span>
            <span class="text-muted-foreground ml-1">
              {ALL_SLASH_COMMANDS.find(c => c.name === parsedCommand?.command)?.description}
            </span>
          {/if}
        {:else}
          <span class="text-destructive">/{parsedCommand?.command}</span>
          <span class="text-muted-foreground ml-1">Unknown command</span>
        {/if}
      {:else}
        <span class="text-muted-foreground/50">Type / for commands</span>
      {/if}
      <span 
        class="text-muted-foreground/50 font-mono truncate" 
        title={cwd ?? undefined}
      >
        {#if cwdLoading}
          Session: …
        {:else if cwd}
          Session: {cwd}
        {:else}
          Session: No active session
        {/if}
      </span>
    </span>
    <span class="text-xs text-muted-foreground/70 text-right flex items-center gap-2">
      <ModelSelector
        models={models}
        currentModel={model}
        currentProvider={provider}
        loading={modelsLoading}
        changing={modelChanging}
        disabled={modelSelectorDisabled}
        enabledModels={enabledModels}
        onchange={onmodelchange}
      />
      {#if isLoading}
        <span>Click stop button or press Escape to cancel</span>
      {/if}
    </span>
  </div>
</div>


