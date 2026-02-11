<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import { parseSlashCommand, isKnownSlashCommand, ALL_SLASH_COMMANDS, getCommandHandler } from '$lib/slash-commands';
  
  interface Props {
    value?: string;
    onsubmit?: (value: string) => void | Promise<void>;
    oninput?: (value: string) => void;
    oncancel?: () => void;
    onslashcommand?: (command: string, args: string, fullText: string) => void | Promise<void>;
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
    onslashcommand,
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

  // Slash command detection
  const parsedCommand = $derived(parseSlashCommand(internalValue));
  const isSlashCommand = $derived(parsedCommand !== null);
  const isKnownCommand = $derived(parsedCommand ? isKnownSlashCommand(parsedCommand.command) : false);
  const commandHandler = $derived(parsedCommand ? getCommandHandler(parsedCommand.command) : null);
  
  // Filter matching commands for autocomplete hint (first 5 matches)
  const matchingCommands = $derived.by(() => {
    if (!isFocused || !isSlashCommand) return [];
    if (!parsedCommand || parsedCommand.args) return [];
    const query = parsedCommand.command.toLowerCase();
    return ALL_SLASH_COMMANDS
      .filter(cmd => cmd.name.toLowerCase().startsWith(query))
      .slice(0, 5);
  });

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
    <div class="absolute bottom-full left-0 right-0 mb-1 bg-popover border border-border rounded-md shadow-lg overflow-hidden z-50">
      {#each matchingCommands as cmd (cmd.name)}
        <div class="flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer">
          <span class="text-sm font-medium text-primary">/{cmd.name}</span>
          <span class="text-sm text-muted-foreground">{cmd.description}</span>
        </div>
      {/each}
    </div>
  {:else if isSlashCommand && isFocused && parsedCommand && !parsedCommand.args && matchingCommands.length === 0}
    <!-- No matches indicator -->
    <div class="absolute bottom-full left-0 mb-1 px-2 py-1 bg-popover border border-border rounded-md shadow-lg">
      <span class="text-xs text-warning">/{parsedCommand.command}</span>
      <span class="text-xs text-muted-foreground ml-2">Unknown command</span>
    </div>
  {/if}

  <div 
    class={cn(
      "flex flex-col w-full bg-foreground/[0.03] border border-input-border rounded-md transition-all duration-100 overflow-hidden",
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
    
    <div class="absolute bottom-2 right-2 flex items-center gap-2">
      <button
        type="button"
        class={cn(
          "flex items-center justify-center w-8 h-8 p-0 bg-transparent border border-border rounded text-muted-foreground cursor-pointer transition-all duration-150",
          "hover:not-disabled:bg-secondary hover:not-disabled:border-foreground hover:not-disabled:text-foreground",
          hasContent && "bg-primary border-primary text-primary-foreground hover:not-disabled:opacity-90",
          !canSubmit && "opacity-40 cursor-not-allowed"
        )}
        disabled={!canSubmit}
        onclick={handleSubmit}
        aria-label={isLoading ? 'Cancel' : 'Submit'}
      >
        {#if isLoading}
          <svg class="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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
    <span class="text-xs">
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
    </span>
    <span class="text-xs text-muted-foreground/70">
      {#if isLoading}
        Press Escape to cancel
      {:else}
        Press Enter to submit, Shift+Enter for new line
      {/if}
    </span>
  </div>
</div>


