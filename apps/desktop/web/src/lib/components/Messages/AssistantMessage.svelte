<script lang="ts">
  import MessageMarkdown from "$lib/components/Messages/MessageMarkdown.svelte";
  import { cn } from "$lib/utils/cn";
  import { computeToolCallSummary } from "$lib/utils/tool-call-summary";
  import type {
    ContentBlock,
    ThinkingBlock,
    ToolCall,
    TextBlock,
  } from "$lib/types/agent";

  interface Props {
    content: ContentBlock[];
    timestamp?: Date;
    isStreaming?: boolean;
  }

  let { content, timestamp, isStreaming }: Props = $props();

  // State for collapsible thinking blocks (default collapsed)
  let thinkingCollapsed = $state<Record<number, boolean>>({});

  // State for collapsible tool blocks (default collapsed)
  let toolCollapsed = $state<Record<string, boolean>>({});

  // State for read tool truncation expansion (default collapsed/preview mode)
  let fullReadResultByToolId = $state<Record<string, boolean>>({});

  // Limits for tool result display (UI-level safety truncation)
  const MAX_RESULT_LINES = 10;
  const MAX_RESULT_BYTES = 10 * 1024; // 10KB

  function isThinkingCollapsed(index: number): boolean {
    // Default collapsed when we haven't seen/toggled this block yet.
    return thinkingCollapsed[index] ?? true;
  }

  function toggleThinking(index: number) {
    thinkingCollapsed[index] = !isThinkingCollapsed(index);
  }

  function isToolCollapsed(id: string): boolean {
    // Default collapsed when we haven't seen/toggled this tool call yet.
    return toolCollapsed[id] ?? true;
  }

  function toggleTool(id: string) {
    toolCollapsed[id] = !isToolCollapsed(id);
  }

  function isReadResultExpanded(id: string): boolean {
    return fullReadResultByToolId[id] ?? false;
  }

  function toggleReadResultExpanded(id: string) {
    fullReadResultByToolId[id] = !isReadResultExpanded(id);
  }

  // Collapse thinking block on click, but only if no text is selected.
  // This allows users to select/copy text without accidentally collapsing.
  function handleThinkingContentClick(index: number, event: MouseEvent): void {
    const selection = window.getSelection();
    if (selection && selection.toString().length > 0) {
      return; // User is selecting text, don't collapse
    }
    toggleThinking(index);
  }

  // Keyboard support for collapsing thinking block (a11y)
  function handleThinkingContentKeydown(
    index: number,
    event: KeyboardEvent,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleThinking(index);
    }
  }

  /**
   * Truncate tool result for display.
   * Returns the truncated result and truncation info.
   */
  function truncateResult(result: string): {
    text: string;
    truncated: boolean;
    totalLines: number;
    truncatedBy: "lines" | "bytes" | null;
  } {
    const totalBytes = new TextEncoder().encode(result).length;
    const lines = result.split("\n");
    const totalLines = lines.length;

    // No truncation needed
    if (totalLines <= MAX_RESULT_LINES && totalBytes <= MAX_RESULT_BYTES) {
      return { text: result, truncated: false, totalLines, truncatedBy: null };
    }

    // Truncate by lines (take first N lines that fit in bytes)
    const outputLines: string[] = [];
    let outputBytes = 0;
    let truncatedBy: "lines" | "bytes" = "lines";

    for (const line of lines) {
      const lineBytes =
        new TextEncoder().encode(line).length +
        (outputLines.length > 0 ? 1 : 0); // +1 for newline

      if (outputLines.length >= MAX_RESULT_LINES) {
        truncatedBy = "lines";
        break;
      }

      if (outputBytes + lineBytes > MAX_RESULT_BYTES) {
        truncatedBy = "bytes";
        break;
      }

      outputLines.push(line);
      outputBytes += lineBytes;
    }

    return {
      text: outputLines.join("\n"),
      truncated: true,
      totalLines,
      truncatedBy,
    };
  }

  const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rs: "rust",
    md: "markdown",
    yml: "yaml",
    sh: "bash",
  };

  function getReadToolPath(block: ToolCall): string | null {
    const path = block.arguments?.path;
    if (typeof path !== "string") return null;

    const trimmed = path.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function detectLanguageFromPath(path: string): string | null {
    const normalized = path.split("#")[0]?.split("?")[0] ?? path;
    const dotIndex = normalized.lastIndexOf(".");
    if (dotIndex < 0 || dotIndex === normalized.length - 1) {
      return null;
    }

    const extension = normalized.slice(dotIndex + 1).toLowerCase();
    return EXTENSION_LANGUAGE_MAP[extension] ?? extension;
  }

  function stripReadLineNumberPrefixes(result: string): string {
    return result
      .split("\n")
      .map((line) => {
        if (line.includes("[... omitted lines")) {
          return line;
        }
        return line.replace(/^\d+:\s/, "");
      })
      .join("\n");
  }

  function formatReadResultMarkdown(block: ToolCall, result: string): string {
    const path = getReadToolPath(block);
    const language = path ? detectLanguageFromPath(path) : null;
    const content = stripReadLineNumberPrefixes(result).trimEnd();

    // Markdown files should be rendered as markdown content (document preview),
    // not wrapped as fenced code blocks.
    if (language === "markdown") {
      return content;
    }

    return `\`\`\`${language ?? ""}\n${content}\n\`\`\``;
  }

  function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
    return block.type === "thinking";
  }

  function isToolCall(block: ContentBlock): block is ToolCall {
    return block.type === "toolCall";
  }

  function isTextBlock(block: ContentBlock): block is TextBlock {
    return block.type === "text";
  }

  // Performance: Memoize computed values to avoid recalculating on every render.
  // These $derived values only recalculate when the content array changes,
  // not when parent components re-render or unrelated state changes.
  type TruncatedResult = ReturnType<typeof truncateResult>;

  // Cache truncated results by toolCallId
  const truncatedResults = $derived.by(() => {
    const cache = new Map<string, TruncatedResult>();
    for (const block of content) {
      if (block.type === "toolCall" && block.result !== undefined) {
        cache.set(block.id, truncateResult(block.result));
      }
    }
    return cache;
  });

  // Cache tool call summaries by toolCallId
  const toolCallSummaries = $derived.by(() => {
    const cache = new Map<string, string | null>();
    for (const block of content) {
      if (block.type === "toolCall") {
        cache.set(block.id, computeToolCallSummary(block));
      }
    }
    return cache;
  });

  // Helper functions to access cached values
  function getTruncatedResult(block: ToolCall): TruncatedResult | null {
    if (block.result === undefined) return null;
    return truncatedResults.get(block.id) ?? null;
  }

  function getToolCallSummary(block: ToolCall): string | null {
    return toolCallSummaries.get(block.id) ?? null;
  }
</script>

<div class={cn("flex w-full animate-fade-in justify-start")}>
  <div class={cn("w-full wrap-break-word", isStreaming && "opacity-90")}>
    <!-- Render blocks in the order they arrive -->
    {#each content as block, blockIndex (block.type === "toolCall" ? block.id : `${block.type}-${blockIndex}`)}
      {#if isThinkingBlock(block)}
        <div
          class="mb-2 last:mb-0 bg-foreground/3 dark:bg-f6fff5/[0.03] border border-border rounded overflow-hidden"
        >
          <button
            type="button"
            class="flex items-center justify-between w-full gap-2 px-3 py-1 bg-foreground/5 dark:bg-f6fff5/[0.05] border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-foreground/8 dark:hover:bg-f6fff5/[0.08] transition-colors cursor-pointer"
            onclick={() => toggleThinking(blockIndex)}
          >
            <div class="flex items-center gap-2">
              <svg
                class="w-3.5 h-3.5"
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
              <span>Thinking</span>
            </div>
            <svg
              class="w-3.5 h-3.5 transition-transform duration-200"
              class:rotate-90={!isThinkingCollapsed(blockIndex)}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          {#if !isThinkingCollapsed(blockIndex)}
            <div
              role="button"
              tabindex="0"
              class="p-3 font-mono text-[0.8125rem] leading-normal text-muted-foreground whitespace-pre-wrap wrap-break-word m-0 cursor-pointer hover:bg-foreground/3 dark:hover:bg-f6fff5/[0.02] transition-colors select-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onclick={(e) => handleThinkingContentClick(blockIndex, e)}
              onkeydown={(e) => handleThinkingContentKeydown(blockIndex, e)}
            >
              {block.thinking}
            </div>
          {/if}
        </div>
      {:else if isToolCall(block)}
        {@const hasResult = block.result !== undefined}
        {@const truncated = getTruncatedResult(block)}
        {@const callSummary = getToolCallSummary(block)}
        {@const collapsed = isToolCollapsed(block.id)}
        {@const isReadResult = block.name === "read" && !block.isError}
        {@const isReadTruncated = isReadResult && !!truncated?.truncated}
        {@const showFullReadResult =
          isReadTruncated && isReadResultExpanded(block.id)}
        {@const readResultText = showFullReadResult
          ? (block.result ?? truncated?.text ?? "")
          : (truncated?.text ?? "")}
        <div
          class={cn(
            "mb-2 last:mb-0 border rounded overflow-hidden",
            !hasResult && "bg-foreground/3 dark:bg-f6fff5/[0.03] border-border",
            hasResult &&
              !block.isError &&
              "bg-emerald-500/[0.03] dark:bg-emerald-500/[0.03] border-emerald-500/20",
            hasResult &&
              block.isError &&
              "bg-destructive/3 dark:bg-destructive/3 border-destructive/20",
          )}
        >
          <button
            type="button"
            class={cn(
              "flex items-center w-full gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer",
              hasResult && !collapsed && "border-b",
              !hasResult &&
                "bg-foreground/5 dark:bg-f6fff5/[0.05] border-border text-muted-foreground hover:bg-foreground/8 dark:hover:bg-f6fff5/[0.08]",
              hasResult &&
                !block.isError &&
                "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15",
              hasResult &&
                block.isError &&
                "bg-destructive/10 border-destructive/20 text-destructive hover:bg-destructive/15",
            )}
            onclick={() => toggleTool(block.id)}
          >
            <svg
              class="w-3.5 h-3.5 shrink-0"
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
            <div class="min-w-0 flex-1 flex items-center gap-1 overflow-hidden">
              <span class="shrink-0">{block.name}</span>
              {#if callSummary}
                <span
                  class="normal-case font-normal tracking-normal opacity-80 truncate"
                  >• {callSummary}</span
                >
              {/if}
            </div>
            {#if !hasResult}
              <span class="ml-auto text-muted-foreground normal-case shrink-0"
                >Running...</span
              >
            {:else if block.isError}
              <span class="ml-auto normal-case shrink-0">Error</span>
            {:else}
              <span class="ml-auto normal-case opacity-60 shrink-0">Done</span>
            {/if}
            <svg
              class="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
              class:rotate-90={!collapsed}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
          {#if hasResult && truncated && !collapsed}
            {#if isReadResult}
              <div class="p-3 m-0 max-h-75 overflow-y-auto">
                <MessageMarkdown
                  content={formatReadResultMarkdown(block, readResultText)}
                  class="message-markdown-read text-[0.8125rem] leading-normal text-foreground wrap-break-word"
                />
              </div>
            {:else}
              <pre
                class="p-3 font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre-wrap wrap-break-word m-0 max-h-75 overflow-y-auto">{truncated.text}</pre>
            {/if}
            {#if truncated.truncated}
              <div
                class={cn(
                  "px-3 py-1.5 text-xs border-t",
                  block.isError
                    ? "bg-destructive/5 border-destructive/10 text-destructive/80"
                    : "bg-emerald-500/5 border-emerald-500/10 text-emerald-600/70 dark:text-emerald-400/70",
                )}
              >
                {#if isReadResult}
                  <span class="inline-flex items-center gap-1 flex-wrap">
                    {#if showFullReadResult}
                      <span
                        >Showing full output ({truncated.totalLines} lines)</span
                      >
                    {:else if truncated.truncatedBy === "lines"}
                      <span>
                        Truncated: showing {truncated.text.split("\n").length} of
                        {truncated.totalLines}
                        lines
                      </span>
                    {:else}
                      <span
                        >Truncated: {MAX_RESULT_BYTES / 1024}KB limit reached</span
                      >
                    {/if}
                    <button
                      type="button"
                      class="underline underline-offset-2 hover:no-underline"
                      onclick={() => toggleReadResultExpanded(block.id)}
                    >
                      {showFullReadResult ? "Show less" : "Show full"}
                    </button>
                  </span>
                {:else if truncated.truncatedBy === "lines"}
                  Truncated: showing {truncated.text.split("\n").length} of {truncated.totalLines}
                  lines
                {:else}
                  Truncated: {MAX_RESULT_BYTES / 1024}KB limit reached
                {/if}
              </div>
            {/if}
          {/if}
        </div>
      {:else if isTextBlock(block)}
        <div
          class="bg-card border border-border rounded-lg px-5 py-2 mb-2 last:mb-0"
        >
          <MessageMarkdown
            content={block.text}
            class="text-[0.9375rem] leading-relaxed text-foreground wrap-break-word"
          />
        </div>
      {/if}
    {/each}
  </div>
</div>
