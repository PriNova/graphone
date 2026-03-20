<script lang="ts">
  import { tick } from "svelte";
  import type { SessionTreeNodeSnapshot } from "$lib/stores/agent.svelte";

  interface GutterInfo {
    position: number;
    show: boolean;
  }

  interface FlatTreeRow {
    node: SessionTreeNodeSnapshot;
    depth: number;
    gutters: GutterInfo[];
    hasChildren: boolean;
    canFold: boolean;
    showConnector: boolean;
    isCollapsed: boolean;
    isLast: boolean;
    onActivePath: boolean;
    isCurrentLeaf: boolean;
  }

  interface Props {
    tree?: SessionTreeNodeSnapshot[];
    currentLeafId?: string | null;
    loading?: boolean;
    error?: string | null;
    navigatingNodeId?: string | null;
    navigatingWithSummary?: boolean;
    cancellingNavigation?: boolean;
    summarizeOnNavigate?: boolean;
    onclose?: () => void;
    onsummarizechange?: (value: boolean) => void | Promise<void>;
    onnavigate?: (nodeId: string) => void | Promise<void>;
    oncancelnavigate?: () => void | Promise<void>;
  }

  let {
    tree = [],
    currentLeafId = null,
    loading = false,
    error = null,
    navigatingNodeId = null,
    navigatingWithSummary = false,
    cancellingNavigation = false,
    summarizeOnNavigate = false,
    onclose,
    onsummarizechange,
    onnavigate,
    oncancelnavigate,
  }: Props = $props();

  let collapsedNodeIds = $state(new Set<string>());
  let treeScrollContainer = $state<HTMLDivElement | null>(null);
  let didAutoScrollOnOpen = $state(false);

  function buildActivePathSet(
    nodes: SessionTreeNodeSnapshot[],
    targetId: string | null,
  ): Set<string> {
    const active = new Set<string>();
    if (!targetId) return active;

    const walk = (items: SessionTreeNodeSnapshot[]): boolean => {
      for (const item of items) {
        if (item.id === targetId) {
          active.add(item.id);
          return true;
        }

        if (walk(item.children)) {
          active.add(item.id);
          return true;
        }
      }

      return false;
    };

    walk(nodes);
    return active;
  }

  function flattenTree(
    nodes: SessionTreeNodeSnapshot[],
    activePath: Set<string>,
    collapsedIds: Set<string>,
  ): FlatTreeRow[] {
    const rows: FlatTreeRow[] = [];
    type StackItem = [
      SessionTreeNodeSnapshot,
      number,
      boolean,
      boolean,
      boolean,
      GutterInfo[],
    ];
    const stack: StackItem[] = [];

    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      stack.push([nodes[i], 0, false, false, i === nodes.length - 1, []]);
    }

    while (stack.length > 0) {
      const [node, depth, justBranched, showConnector, isLast, gutters] =
        stack.pop()!;
      const hasChildren = node.children.length > 0;
      const canFold = node.children.length > 1;
      const isCurrentLeaf = currentLeafId === node.id;
      const onActivePath = activePath.has(node.id);
      const isCollapsed = canFold && collapsedIds.has(node.id);

      rows.push({
        node,
        depth,
        gutters,
        hasChildren,
        canFold,
        showConnector,
        isCollapsed,
        isLast,
        onActivePath,
        isCurrentLeaf,
      });

      if (!hasChildren || isCollapsed) {
        continue;
      }

      const children = node.children;
      const multipleChildren = children.length > 1;
      const childDepth = multipleChildren
        ? depth + 1
        : justBranched && depth > 0
          ? depth + 1
          : depth;
      const connectorPosition = Math.max(0, depth - 1);
      const childGutters = showConnector
        ? [...gutters, { position: connectorPosition, show: !isLast }]
        : gutters;

      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push([
          children[i],
          childDepth,
          multipleChildren,
          multipleChildren,
          i === children.length - 1,
          childGutters,
        ]);
      }
    }

    return rows;
  }

  const activePath = $derived(buildActivePathSet(tree, currentLeafId));
  const rows = $derived(flattenTree(tree, activePath, collapsedNodeIds));

  function getBadgeLabel(node: SessionTreeNodeSnapshot): string {
    if (node.entryType === "branchSummary") return "SUMMARY";
    if (node.entryType === "compaction") return "COMPACT";
    if (node.entryType === "customMessage") return "CUSTOM";

    switch (node.role) {
      case "user":
        return "USER";
      case "assistant":
        return "ASSISTANT";
      case "toolResult":
        return "TOOL";
      case "bashExecution":
        return "BASH";
      case "custom":
        return "CUSTOM";
      default:
        return "STEP";
    }
  }

  function getActionLabel(node: SessionTreeNodeSnapshot): string {
    return node.role === "user" ? "Branch" : "Continue";
  }

  function isNavigatingTarget(row: FlatTreeRow): boolean {
    return navigatingNodeId === row.node.id;
  }

  function isCancelRow(row: FlatTreeRow): boolean {
    return isNavigatingTarget(row) && navigatingWithSummary;
  }

  function getPreviewClass(node: SessionTreeNodeSnapshot): string {
    if (node.role === "toolResult" || node.role === "bashExecution") {
      return "font-mono text-[12px] text-foreground/92";
    }

    if (node.entryType === "branchSummary" || node.entryType === "compaction") {
      return "text-[12px] text-muted-foreground";
    }

    return "text-[12.5px] text-foreground";
  }

  function getBadgeClass(node: SessionTreeNodeSnapshot): string {
    switch (node.role) {
      case "user":
        return "border-border bg-surface text-muted-foreground";
      case "assistant":
        return "border-border bg-surface text-muted-foreground";
      case "toolResult":
        return "border-border bg-surface text-muted-foreground";
      case "bashExecution":
        return "border-border bg-surface text-muted-foreground";
      default:
        return "border-border bg-surface text-muted-foreground";
    }
  }

  function shouldShowGuide(row: FlatTreeRow, position: number): boolean {
    return row.gutters.some(
      (gutter) => gutter.position === position && gutter.show,
    );
  }

  function getIndentColumns(row: FlatTreeRow): number[] {
    return Array.from({ length: row.depth }, (_, index) => index);
  }

  function toggleCollapse(nodeId: string): void {
    const next = new Set(collapsedNodeIds);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    collapsedNodeIds = next;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onclose?.();
  }

  async function handleSummarizeChange(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    await onsummarizechange?.(target.checked);
  }

  $effect(() => {
    if (
      loading ||
      rows.length === 0 ||
      didAutoScrollOnOpen ||
      !treeScrollContainer
    ) {
      return;
    }

    didAutoScrollOnOpen = true;

    void tick().then(() => {
      treeScrollContainer?.scrollTo({
        top: treeScrollContainer.scrollHeight,
        behavior: "auto",
      });
    });
  });
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-b-[1.35rem] rounded-t-none border border-border/80 bg-[#0f130f]/94 shadow-[0_26px_80px_rgba(0,0,0,0.42)] ring-1 ring-black/20 backdrop-blur-md"
>
  <header class="shrink-0 border-b border-border/80 bg-card/80 px-5 py-4">
    <div>
      <h2 class="text-[1.35rem] font-semibold tracking-tight text-foreground">
        Session Tree
      </h2>
      <p class="mt-1 max-w-3xl text-sm text-muted-foreground">
        Pick any point in the transcript. Choosing a user message reopens it in
        the prompt so you can edit and branch from there.
      </p>
    </div>

    <label
      class="mt-4 flex items-start gap-3 rounded-xl border border-border/80 bg-surface/80 px-4 py-3"
    >
      <input
        type="checkbox"
        class="mt-0.5 h-4 w-4 rounded border-border bg-background"
        checked={summarizeOnNavigate}
        disabled={navigatingNodeId !== null}
        onchange={handleSummarizeChange}
      />
      <span>
        <span class="block text-sm font-medium text-foreground">
          Summarize the branch you leave behind
        </span>
        <span class="block text-xs text-muted-foreground">
          Off by default. Turn this on when you want Graphone to save a short
          bridge note before switching branches.
        </span>
      </span>
    </label>
  </header>

  <div
    class="flex-1 min-h-0 overflow-y-auto px-5 py-4"
    bind:this={treeScrollContainer}
  >
    {#if loading}
      <div class="flex h-full items-center justify-center">
        <div
          class="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground"
        >
          Loading the session tree…
        </div>
      </div>
    {:else if error}
      <div
        class="rounded-lg border border-destructive/40 bg-destructive/10 px-5 py-4 text-sm text-destructive"
      >
        {error}
      </div>
    {:else if rows.length === 0}
      <div class="flex h-full items-center justify-center">
        <div
          class="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground"
        >
          This session does not have any transcript entries yet.
        </div>
      </div>
    {:else}
      <div
        class="rounded-lg border border-border bg-[#151916] shadow-[0_0_0_1px_rgba(0,0,0,0.18)]"
      >
        {#each rows as row (row.node.id)}
          <div
            class={`group relative flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0 ${
              row.isCurrentLeaf
                ? "bg-secondary/35"
                : row.onActivePath
                  ? "bg-secondary/10"
                  : "hover:bg-secondary/10"
            }`}
          >
            <div
              class="absolute inset-y-0 left-0 w-px bg-transparent group-hover:bg-border"
            ></div>

            <div class="flex min-w-0 flex-1 items-center">
              <div aria-hidden="true" class="flex h-6 shrink-0 items-stretch">
                {#each getIndentColumns(row) as columnIndex (columnIndex)}
                  <div class="relative h-6 w-5 shrink-0">
                    {#if shouldShowGuide(row, columnIndex)}
                      <span class="absolute inset-y-0 left-2 w-px bg-border"
                      ></span>
                    {/if}
                    {#if row.showConnector && columnIndex === row.depth - 1}
                      <span
                        class="absolute left-2 top-0 bottom-3 w-px bg-border"
                      ></span>
                      {#if !row.isLast}
                        <span
                          class="absolute bottom-0 left-2 top-3 w-px bg-border"
                        ></span>
                      {/if}
                      <span class="absolute left-2 top-3 h-px w-3 bg-border"
                      ></span>
                    {/if}
                  </div>
                {/each}
              </div>

              <button
                type="button"
                class={`mr-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground ${
                  row.canFold ? "opacity-100" : "pointer-events-none opacity-0"
                }`}
                aria-label={row.isCollapsed
                  ? "Expand branch"
                  : "Collapse branch"}
                disabled={!row.canFold}
                onclick={(event) => {
                  event.stopPropagation();
                  if (row.canFold) toggleCollapse(row.node.id);
                }}
              >
                {#if row.canFold}
                  <svg
                    aria-hidden="true"
                    class={`h-3.5 w-3.5 transition-transform ${row.isCollapsed ? "rotate-0" : "rotate-90"}`}
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M6 3.5 11 8l-5 4.5z"></path>
                  </svg>
                {/if}
              </button>

              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-1 py-0.5 text-left"
                disabled={row.isCurrentLeaf || navigatingNodeId !== null}
                onclick={() => onnavigate?.(row.node.id)}
              >
                <span
                  class={`shrink-0 rounded-[3px] border px-1.5 py-[2px] text-[9px] font-semibold tracking-[0.14em] ${getBadgeClass(
                    row.node,
                  )}`}
                >
                  {getBadgeLabel(row.node)}
                </span>

                <span
                  class={`min-w-0 truncate leading-5 ${getPreviewClass(row.node)}`}
                  title={row.node.preview}
                >
                  {row.node.preview}
                </span>
              </button>
            </div>

            <div class="shrink-0 pl-3">
              <button
                type="button"
                class={`inline-flex min-w-[5.75rem] items-center justify-center rounded-sm border px-2.5 py-1 text-[11px] font-medium tracking-[0.02em] transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                  row.isCurrentLeaf
                    ? "border-foreground/20 bg-foreground/10 text-foreground"
                    : isCancelRow(row)
                      ? "border-destructive/40 bg-destructive/10 text-destructive hover:border-destructive hover:bg-destructive/15"
                      : "border-border bg-background text-muted-foreground hover:border-foreground hover:bg-secondary hover:text-foreground"
                }`}
                disabled={row.isCurrentLeaf ||
                  (navigatingNodeId !== null && !isCancelRow(row)) ||
                  cancellingNavigation}
                onclick={() => {
                  if (isCancelRow(row)) {
                    oncancelnavigate?.();
                    return;
                  }
                  onnavigate?.(row.node.id);
                }}
              >
                {#if row.isCurrentLeaf}
                  Current
                {:else if isCancelRow(row)}
                  {cancellingNavigation ? "Cancelling…" : "Cancel"}
                {:else if isNavigatingTarget(row)}
                  Switching…
                {:else}
                  {getActionLabel(row.node)}
                {/if}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
