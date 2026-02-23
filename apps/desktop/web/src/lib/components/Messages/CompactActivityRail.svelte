<script lang="ts">
  import { flip } from "svelte/animate";
  import MessageMarkdown from "$lib/components/Messages/MessageMarkdown.svelte";
  import { cn } from "$lib/utils/cn";
  import { computeToolCallSummary } from "$lib/utils/tool-call-summary";
  import type { ThinkingBlock, ToolCall } from "$lib/types/agent";

  export type CompactActivityItem =
    | {
        key: string;
        type: "user";
        block: { summary: string };
      }
    | {
        key: string;
        type: "assistant";
        block: { markdown: string };
      }
    | {
        key: string;
        type: "thinking";
        block: ThinkingBlock;
      }
    | {
        key: string;
        type: "toolCall";
        block: ToolCall;
      };

  interface Props {
    items: CompactActivityItem[];
    assistantStreaming?: boolean;
  }

  let { items, assistantStreaming = false }: Props = $props();

  let assistantScrollRef = $state<HTMLDivElement | null>(null);
  let assistantScrollRaf: number | null = null;

  function scheduleAssistantScrollToBottom(): void {
    if (
      !assistantStreaming ||
      !assistantScrollRef ||
      assistantScrollRaf !== null
    ) {
      return;
    }

    assistantScrollRaf = requestAnimationFrame(() => {
      assistantScrollRaf = null;
      if (!assistantStreaming || !assistantScrollRef) {
        return;
      }

      assistantScrollRef.scrollTop = assistantScrollRef.scrollHeight;
    });
  }

  $effect(() => {
    if (!assistantStreaming) {
      return;
    }

    items;
    scheduleAssistantScrollToBottom();

    return () => {
      if (assistantScrollRaf !== null) {
        cancelAnimationFrame(assistantScrollRaf);
        assistantScrollRaf = null;
      }
    };
  });
</script>

<div class="flex w-full flex-col gap-1">
  {#each items as item (item.key)}
    <div class="w-full" animate:flip={{ duration: 160 }}>
      {#if item.type === "user"}
        <div
          class="animate-fade-in flex h-7 w-full items-center gap-2 rounded-full border border-primary bg-primary px-3 text-[0.6875rem] text-primary-foreground"
        >
          <svg
            class="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
          <span class="shrink-0 font-semibold uppercase tracking-wider"
            >You</span
          >
          <span class="min-w-0 truncate">• {item.block.summary}</span>
        </div>
      {:else if item.type === "assistant"}
        <div
          class="animate-fade-in flex h-56 w-full flex-col rounded-xl border px-3 py-2"
          style="background-color:#0b0d0b;border-color:#3b3f46;color:#f6fff5;"
        >
          <div
            class="mb-1 flex items-center gap-2 text-[0.6875rem] font-semibold uppercase tracking-wider"
          >
            <svg
              class="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
              />
            </svg>
            <span>Assistant</span>
          </div>

          <div
            bind:this={assistantScrollRef}
            class="min-h-0 flex-1 overflow-y-auto pr-1"
          >
            <MessageMarkdown
              content={item.block.markdown}
              class="text-[0.75rem] leading-relaxed text-inherit wrap-break-word"
            />
          </div>
        </div>
      {:else if item.type === "thinking"}
        <div
          class="animate-fade-in flex h-7 w-full items-center gap-2 rounded-full border border-border bg-background px-3 text-[0.6875rem] text-foreground"
        >
          <svg
            class="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
            />
          </svg>
          <span class="shrink-0 font-semibold uppercase tracking-wider"
            >Thinking</span
          >
        </div>
      {:else}
        {@const summary = computeToolCallSummary(item.block)}
        {@const hasResult = item.block.result !== undefined}
        {@const chipStyle = !hasResult
          ? "background-color:#1f2329;border-color:#3b3f46;color:#f5f7fa;"
          : item.block.isError
            ? "background-color:#dc2626;border-color:#fca5a5;color:#ffffff;"
            : "background-color:#0b0d0b;border-color:#3b3f46;color:#f6fff5;"}
        <div
          class={cn(
            "animate-fade-in flex h-7 w-full items-center gap-2 rounded-full border px-3 text-[0.6875rem]",
          )}
          style={chipStyle}
        >
          <svg
            class="h-3.5 w-3.5 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>

          <span class="shrink-0 font-semibold uppercase tracking-wider"
            >{item.block.name}</span
          >

          {#if summary}
            <span class="min-w-0 truncate">• {summary}</span>
          {/if}

          <span class="ml-auto shrink-0 normal-case">
            {#if !hasResult}
              Running...
            {:else if item.block.isError}
              Error
            {:else}
              Done
            {/if}
          </span>
        </div>
      {/if}
    </div>
  {/each}
</div>
