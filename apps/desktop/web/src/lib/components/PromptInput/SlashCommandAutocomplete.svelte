<script lang="ts">
  import { cn } from "$lib/utils/cn";
  import type { SlashCommand } from "$lib/slash-commands";

  interface Props {
    isOpen?: boolean;
    matchingCommands: SlashCommand[];
    selectedCommandIndex: number;
    isKnownCommand: boolean;
    commandHandler: string | null;
    matchedCommand: SlashCommand | null;
    parsedCommand: { command: string; args: string | null } | null;
    onselectcommand: (cmd: SlashCommand) => void;
    onindexchange: (index: number) => void;
  }

  let {
    isOpen = false,
    matchingCommands,
    selectedCommandIndex,
    isKnownCommand,
    commandHandler,
    matchedCommand,
    parsedCommand,
    onselectcommand,
    onindexchange,
  }: Props = $props();
</script>

{#if isOpen && matchingCommands.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="absolute bottom-full left-0 right-0 mb-1 bg-background border border-border rounded-md max-h-64 overflow-y-auto z-50"
    onmousedown={(e) => e.preventDefault()}
  >
    {#each matchingCommands as cmd, index (cmd.name)}
      <button
        type="button"
        class={cn(
          "flex items-center gap-2 px-3 py-2 w-full text-left cursor-pointer",
          index === selectedCommandIndex && "bg-accent",
        )}
        onmouseenter={() => onindexchange(index)}
        onclick={() => onselectcommand(cmd)}
      >
        <span class="text-sm font-medium text-primary">/{cmd.name}</span>
        <span class="text-sm text-muted-foreground">{cmd.description}</span>
      </button>
    {/each}
  </div>
{:else if isOpen && matchingCommands.length === 0 && parsedCommand && !parsedCommand.args}
  <!-- No matches indicator -->
  <div
    class="absolute bottom-full left-0 mb-1 px-2 py-1 bg-background border border-border rounded-md"
  >
    <span class="text-xs text-warning">/{parsedCommand.command}</span>
    <span class="text-xs text-muted-foreground ml-2">Unknown command</span>
  </div>
{/if}
