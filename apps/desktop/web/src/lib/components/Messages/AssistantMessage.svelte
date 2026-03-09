<script lang="ts">
  /* eslint-disable svelte/no-at-html-tags */
  import DOMPurify from "dompurify";

  import MessageMarkdown from "$lib/components/Messages/MessageMarkdown.svelte";
  import { MessagesStore } from "$lib/stores/messages.svelte";
  import { cn } from "$lib/utils/cn";
  import { computeToolCallSummary } from "$lib/utils/tool-call-summary";
  import type {
    ContentBlock,
    ThinkingBlock,
    ToolCall,
    ToolResultMessage,
    TextBlock,
  } from "$lib/types/agent";

  interface Props {
    content: ContentBlock[];
    timestamp?: Date;
    isStreaming?: boolean;
    getToolResult?: (toolCallId: string) => ToolResultMessage | undefined;
    isToolPending?: (toolCallId: string) => boolean;
    defaultThinkingCollapsed?: boolean;
    defaultToolCollapsed?: boolean;
  }

  let {
    content,
    timestamp,
    isStreaming,
    getToolResult,
    isToolPending,
    defaultThinkingCollapsed = true,
    defaultToolCollapsed = true,
  }: Props = $props();

  // State for collapsible thinking blocks (default collapsed)
  let thinkingCollapsed = $state<Record<number, boolean>>({});

  // State for collapsible tool blocks (default collapsed)
  let toolCollapsed = $state<Record<string, boolean>>({});

  // State for tool result truncation expansion (default collapsed/preview mode)
  let fullToolResultByToolId = $state<Record<string, boolean>>({});

  // Limits for tool result display (UI-level safety truncation)
  const MAX_RESULT_LINES = 10;
  const MAX_RESULT_BYTES = 10 * 1024; // 10KB

  function isThinkingCollapsed(index: number): boolean {
    // Default to configured global preference when we haven't toggled this block.
    return thinkingCollapsed[index] ?? defaultThinkingCollapsed;
  }

  function toggleThinking(index: number) {
    thinkingCollapsed[index] = !isThinkingCollapsed(index);
  }

  function isToolCollapsed(id: string): boolean {
    // Default to configured global preference when we haven't toggled this block.
    return toolCollapsed[id] ?? defaultToolCollapsed;
  }

  function toggleTool(id: string) {
    toolCollapsed[id] = !isToolCollapsed(id);
  }

  function isToolResultExpanded(id: string): boolean {
    return fullToolResultByToolId[id] ?? false;
  }

  function toggleToolResultExpanded(id: string) {
    fullToolResultByToolId[id] = !isToolResultExpanded(id);
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

  interface AutoScrollPayload {
    enabled: boolean;
    token: number;
  }

  function autoScrollToBottomOnUpdate(
    node: HTMLElement,
    payload: AutoScrollPayload,
  ) {
    const sync = (next: AutoScrollPayload) => {
      if (!next.enabled) {
        return;
      }

      requestAnimationFrame(() => {
        node.scrollTop = node.scrollHeight;
      });
    };

    sync(payload);

    return {
      update(nextPayload: AutoScrollPayload) {
        sync(nextPayload);
      },
    };
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

  function resolveToolResult(block: ToolCall): ToolResultMessage | undefined {
    return getToolResult?.(block.id);
  }

  function resolveToolResultText(block: ToolCall): string | undefined {
    const toolResult = resolveToolResult(block);
    if (toolResult) {
      return MessagesStore.formatToolResultContent(toolResult.content);
    }

    return block.result;
  }

  function resolveToolResultError(block: ToolCall): boolean {
    const toolResult = resolveToolResult(block);
    if (toolResult) {
      return toolResult.isError;
    }

    return block.isError === true;
  }

  function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  function resolveSanitizedToolResultHtml(block: ToolCall): string | null {
    const toolResult = resolveToolResult(block);
    if (!toolResult || !isObjectRecord(toolResult.details)) {
      return null;
    }

    const rawHtml = toolResult.details._html;
    if (typeof rawHtml !== "string") {
      return null;
    }

    const trimmedHtml = rawHtml.trim();
    if (trimmedHtml.length === 0) {
      return null;
    }

    const sanitized = String(
      DOMPurify.sanitize(trimmedHtml, {
        USE_PROFILES: { html: true, svg: true, svgFilters: true },
        ADD_TAGS: [
          "svg",
          "g",
          "path",
          "circle",
          "rect",
          "line",
          "polyline",
          "polygon",
          "ellipse",
          "text",
          "tspan",
          "defs",
          "marker",
          "linearGradient",
          "radialGradient",
          "stop",
        ],
        ALLOWED_URI_REGEXP:
          /^(?:(?:https?|mailto|tel):|data:image\/(?:png|gif|jpe?g|webp|svg\+xml)(?:;charset=[^;,]+)?(?:;base64)?,)/,
        FORBID_TAGS: ["script", "object", "embed", "form", "button"],
        ALLOWED_ATTR: [
          "src",
          "href",
          "class",
          "style",
          "srcset",
          "alt",
          "title",
          "width",
          "height",
          "loading",
          "name",
          "id",
          "xmlns",
          "viewBox",
          "viewbox",
          "preserveAspectRatio",
          "preserveaspectratio",
          "fill",
          "fill-rule",
          "fill-opacity",
          "stroke",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-dasharray",
          "stroke-dashoffset",
          "stroke-opacity",
          "opacity",
          "transform",
          "d",
          "points",
          "x",
          "y",
          "x1",
          "y1",
          "x2",
          "y2",
          "cx",
          "cy",
          "r",
          "rx",
          "ry",
          "dx",
          "dy",
          "pathLength",
          "pathlength",
          "marker-start",
          "marker-mid",
          "marker-end",
          "font-family",
          "font-size",
          "font-weight",
          "text-anchor",
          "dominant-baseline",
          "alignment-baseline",
          "baseline-shift",
          "role",
          "aria-label",
          "aria-labelledby",
          "aria-hidden",
          "focusable",
          "tabindex",
          "xlink:href",
          "xmlns:xlink",
        ],
      }),
    ).trim();

    return sanitized.length > 0 ? sanitized : null;
  }

  type DiffLineKind = "added" | "removed" | "hunk" | "meta" | "context";

  interface ParsedDiffLine {
    kind: DiffLineKind;
    text: string;
  }

  function resolveEditDiff(block: ToolCall): string | null {
    if (block.name !== "edit") {
      return null;
    }

    const toolResult = resolveToolResult(block);
    if (!toolResult || !isObjectRecord(toolResult.details)) {
      return null;
    }

    const rawDiff = toolResult.details.diff;
    if (typeof rawDiff !== "string") {
      return null;
    }

    const trimmedDiff = rawDiff.trim();
    return trimmedDiff.length > 0 ? trimmedDiff : null;
  }

  function classifyDiffLine(line: string): DiffLineKind {
    if (line.startsWith("@@")) {
      return "hunk";
    }

    if (line.startsWith("+") && !line.startsWith("+++ ")) {
      return "added";
    }

    if (line.startsWith("-") && !line.startsWith("--- ")) {
      return "removed";
    }

    if (
      line.startsWith("+++ ") ||
      line.startsWith("--- ") ||
      line.startsWith("diff ") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ") ||
      line.startsWith("Binary files ")
    ) {
      return "meta";
    }

    return "context";
  }

  function parseUnifiedDiff(diff: string): ParsedDiffLine[] {
    return diff.split("\n").map((line) => ({
      kind: classifyDiffLine(line),
      text: line,
    }));
  }

  // Performance: Memoize computed values to avoid recalculating on every render.
  // These $derived values only recalculate when the content array changes,
  // not when parent components re-render or unrelated state changes.
  type TruncatedResult = ReturnType<typeof truncateResult>;

  // Cache truncated results by toolCallId
  const truncatedResults = $derived.by(() => {
    const cache = new Map<string, TruncatedResult>();
    for (const block of content) {
      if (block.type !== "toolCall") {
        continue;
      }

      const result = resolveToolResultText(block);
      if (result !== undefined) {
        cache.set(block.id, truncateResult(result));
      }
    }
    return cache;
  });

  // Cache sanitized tool-result HTML by toolCallId
  const toolResultHtmlByCallId = $derived.by(() => {
    const cache = new Map<string, string>();
    for (const block of content) {
      if (block.type !== "toolCall") {
        continue;
      }

      const sanitizedHtml = resolveSanitizedToolResultHtml(block);
      if (sanitizedHtml) {
        cache.set(block.id, sanitizedHtml);
      }
    }
    return cache;
  });

  // Cache parsed edit diffs by toolCallId
  const editDiffLinesByCallId = $derived.by(() => {
    const cache = new Map<string, ParsedDiffLine[]>();

    for (const block of content) {
      if (block.type !== "toolCall") {
        continue;
      }

      const diff = resolveEditDiff(block);
      if (diff) {
        cache.set(block.id, parseUnifiedDiff(diff));
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
    return truncatedResults.get(block.id) ?? null;
  }

  function getToolResultHtml(block: ToolCall): string | null {
    return toolResultHtmlByCallId.get(block.id) ?? null;
  }

  function getEditDiffLines(block: ToolCall): ParsedDiffLine[] | null {
    return editDiffLinesByCallId.get(block.id) ?? null;
  }

  function getToolCallSummary(block: ToolCall): string | null {
    return toolCallSummaries.get(block.id) ?? null;
  }
</script>

<div class={cn("flex w-full animate-fade-in justify-start")}>
  <div class={cn("w-full wrap-break-word", isStreaming && "opacity-90")}>
    <!-- Render blocks in the order they arrive -->
    {#each content as block, blockIndex (block.type === "toolCall" ? block.id : `${block.type}-${blockIndex}`)}
      <div class:mt-2={blockIndex > 0}>
        {#if isThinkingBlock(block)}
          <div class="bg-surface border border-border rounded overflow-hidden">
            <button
              type="button"
              class="flex items-center justify-between w-full gap-2 px-3 py-1 bg-surface-active border-b border-border text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:bg-surface-hover transition-colors cursor-pointer"
              onclick={() => toggleThinking(blockIndex)}
            >
              <div class="flex min-w-0 items-center gap-2">
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
                    d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                  />
                </svg>
                <span class="shrink-0">Thinking</span>
                {#if block.isRunning}
                  <span
                    class="truncate normal-case font-normal tracking-normal opacity-80"
                    >• Running ...</span
                  >
                {/if}
              </div>
              <svg
                class="w-3.5 h-3.5 shrink-0 transition-transform duration-200"
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
                class="p-3 font-mono text-[0.8125rem] leading-normal text-muted-foreground whitespace-pre-wrap wrap-break-word m-0 cursor-pointer hover:bg-surface-hover transition-colors select-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                onclick={(e) => handleThinkingContentClick(blockIndex, e)}
                onkeydown={(e) => handleThinkingContentKeydown(blockIndex, e)}
              >
                {block.thinking}
              </div>
            {/if}
          </div>
        {:else if isToolCall(block)}
          {@const resultText = resolveToolResultText(block)}
          {@const isError = resolveToolResultError(block)}
          {@const hasResult = resultText !== undefined}
          {@const pending = isToolPending?.(block.id) ?? !hasResult}
          {@const truncated = getTruncatedResult(block)}
          {@const toolResultHtml = getToolResultHtml(block)}
          {@const hasToolResultHtml = toolResultHtml !== null}
          {@const editDiffLines = getEditDiffLines(block)}
          {@const hasEditDiff = !!editDiffLines && editDiffLines.length > 0}
          {@const callSummary = getToolCallSummary(block)}
          {@const collapsed = isToolCollapsed(block.id)}
          {@const isBashOutput = block.name === "bash" && hasResult}
          {@const isReadResult = block.name === "read" && !isError}
          {@const isTruncated = !!truncated?.truncated}
          {@const canExpandResult =
            !isBashOutput && (isTruncated || hasToolResultHtml)}
          {@const showFullResult =
            canExpandResult && isToolResultExpanded(block.id)}
          {@const displayedResultText = isBashOutput
            ? (resultText ?? "")
            : showFullResult
              ? (resultText ?? truncated?.text ?? "")
              : (truncated?.text ?? "")}
          <div
            class={cn(
              "border rounded overflow-hidden",
              (!hasResult || pending) && "bg-surface border-border",
              hasResult && !pending && !isError && "bg-surface border-border",
              hasResult &&
                !pending &&
                isError &&
                "bg-destructive-surface border-destructive",
            )}
          >
            <button
              type="button"
              class={cn(
                "flex items-center w-full gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer",
                hasResult && !collapsed && "border-b",
                (!hasResult || pending) &&
                  "bg-surface-active border-border text-muted-foreground hover:bg-surface-hover",
                hasResult &&
                  !pending &&
                  !isError &&
                  "bg-surface-active border-border text-foreground hover:bg-surface-hover",
                hasResult &&
                  !pending &&
                  isError &&
                  "bg-destructive-surface border-destructive text-destructive hover:bg-destructive-surface-hover",
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
              <div
                class="min-w-0 flex-1 flex items-center gap-1 overflow-hidden"
              >
                <span class="shrink-0">{block.name}</span>
                {#if callSummary}
                  <span
                    class="normal-case font-normal tracking-normal opacity-80 truncate"
                    >• {callSummary}</span
                  >
                {/if}
              </div>
              {#if pending || !hasResult}
                <span class="ml-auto text-muted-foreground normal-case shrink-0"
                  >Running...</span
                >
              {:else if isError}
                <span class="ml-auto normal-case shrink-0">Error</span>
              {:else}
                <span class="ml-auto normal-case opacity-60 shrink-0">Done</span
                >
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
              {#if hasToolResultHtml}
                <div
                  class={cn(
                    "p-3 text-[0.8125rem] leading-normal text-foreground wrap-break-word m-0",
                    showFullResult
                      ? "overflow-visible"
                      : "max-h-75 overflow-auto",
                  )}
                >
                  {@html toolResultHtml ?? ""}
                </div>
              {:else if hasEditDiff}
                <div
                  class="m-0 max-h-75 overflow-y-auto border-t border-border"
                >
                  <div
                    class="font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre"
                  >
                    {#each editDiffLines as line, lineIndex (`${block.id}-diff-${lineIndex}`)}
                      <div
                        class={cn(
                          "px-3 py-0.5",
                          line.kind === "added" &&
                            "bg-success-surface border-l-2 border-success text-success",
                          line.kind === "removed" &&
                            "bg-destructive-surface border-l-2 border-destructive text-destructive",
                          line.kind === "hunk" &&
                            "bg-surface-active text-sky-700 dark:text-sky-300",
                          line.kind === "meta" &&
                            "bg-surface text-muted-foreground",
                        )}
                      >
                        {line.text || " "}
                      </div>
                    {/each}
                  </div>
                </div>
              {:else if isBashOutput}
                <div
                  class="max-h-75 overflow-y-auto"
                  use:autoScrollToBottomOnUpdate={{
                    enabled: pending,
                    token: resultText?.length ?? 0,
                  }}
                >
                  <pre
                    class="p-3 font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre-wrap wrap-break-word m-0">{resultText ??
                      ""}</pre>
                </div>
              {:else if isReadResult}
                <div class="p-3 m-0 max-h-75 overflow-y-auto">
                  <MessageMarkdown
                    content={formatReadResultMarkdown(
                      block,
                      displayedResultText,
                    )}
                    class="message-markdown-read text-[0.8125rem] leading-normal text-foreground wrap-break-word"
                  />
                </div>
              {:else}
                <pre
                  class="p-3 font-mono text-[0.8125rem] leading-normal text-foreground whitespace-pre-wrap wrap-break-word m-0 max-h-75 overflow-y-auto">{displayedResultText}</pre>
              {/if}
              {#if (truncated.truncated || hasToolResultHtml) && !hasEditDiff && !isBashOutput}
                <div
                  class={cn(
                    "px-3 py-1.5 text-xs border-t",
                    isError
                      ? "bg-destructive-surface border-destructive text-destructive"
                      : pending
                        ? "bg-surface border-border text-muted-foreground"
                        : "bg-surface border-border text-muted-foreground",
                  )}
                >
                  <span class="inline-flex items-center gap-1 flex-wrap">
                    {#if hasToolResultHtml}
                      <span>
                        {showFullResult
                          ? "Showing full HTML result"
                          : "Constrained HTML preview in tool panel"}
                      </span>
                    {:else if showFullResult}
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
                      onclick={() => toggleToolResultExpanded(block.id)}
                    >
                      {showFullResult
                        ? "Show less"
                        : hasToolResultHtml
                          ? "Show full"
                          : "Show full"}
                    </button>
                  </span>
                </div>
              {/if}
            {/if}
          </div>
        {:else if isTextBlock(block)}
          <div class="bg-card border border-border rounded-lg px-5 py-2">
            <MessageMarkdown
              content={block.text}
              class="text-[0.9375rem] leading-relaxed text-foreground wrap-break-word"
            />
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>
