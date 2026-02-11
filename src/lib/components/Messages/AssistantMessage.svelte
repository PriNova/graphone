<script lang="ts">
  import { cn } from '$lib/utils/cn';
  import type { ContentBlock, ThinkingBlock, ToolCall, TextBlock } from '$lib/types/agent';

  interface Props {
    content: ContentBlock[];
    timestamp?: Date;
    isStreaming?: boolean;
  }

  let { content, timestamp, isStreaming }: Props = $props();

  function formatToolArguments(args: Record<string, unknown>): string {
    return JSON.stringify(args, null, 2);
  }

  function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
    return block.type === 'thinking';
  }

  function isToolCall(block: ContentBlock): block is ToolCall {
    return block.type === 'toolCall';
  }

  function isTextBlock(block: ContentBlock): block is TextBlock {
    return block.type === 'text';
  }
</script>

<div class={cn(
  "flex w-full animate-fade-in justify-start"
)}>
  <div class={cn(
    "w-full bg-card border border-border rounded-lg px-5 py-4 break-words",
    isStreaming && "opacity-90"
  )}>
    <div class="mb-2">
      <span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Assistant</span>
    </div>
    
    <!-- Render blocks in the order they arrive -->
    {#each content as block (block.type === 'toolCall' ? block.id : block.type + '-' + content.indexOf(block))}
      {#if isThinkingBlock(block)}
        <div class="mb-3 bg-foreground/[0.03] dark:bg-f6fff5/[0.03] border border-border rounded overflow-hidden">
          <div class="flex items-center gap-2 px-3 py-2 bg-foreground/[0.05] dark:bg-f6fff5/[0.05] border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            <span>Thinking</span>
          </div>
          <pre class="p-3 font-mono text-[0.8125rem] leading-normal text-muted-foreground whitespace-pre-wrap break-words m-0">{block.thinking}</pre>
        </div>
      {:else if isToolCall(block)}
        <div class="mb-3 bg-foreground/[0.03] dark:bg-f6fff5/[0.03] border border-border rounded overflow-hidden">
          <div class="flex items-center gap-2 px-3 py-2 bg-foreground/[0.05] dark:bg-f6fff5/[0.05] border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>Tool: {block.name}</span>
          </div>
          <pre class="p-3 font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre-wrap break-words m-0 max-h-[200px] overflow-y-auto">{formatToolArguments(block.arguments)}</pre>
        </div>
      {:else if isTextBlock(block)}
        <div class="text-[0.9375rem] leading-relaxed text-foreground whitespace-pre-wrap break-words mt-3 first:mt-0">{block.text}</div>
      {/if}
    {/each}
  </div>
</div>
