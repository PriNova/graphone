<script lang="ts">
  import type { RegisteredExtensionSummary } from "$lib/stores/agent.svelte";

  interface Props {
    displayMode?: "full" | "compact";
    toolResultsCollapsedByDefault?: boolean;
    thinkingCollapsedByDefault?: boolean;
    isExtensionsLoading?: boolean;
    extensionsLoadError?: string | null;
    globalExtensions?: RegisteredExtensionSummary[];
    localExtensions?: RegisteredExtensionSummary[];
    extensionLoadDiagnostics?: Array<{ path: string; error: string }>;
    ondisplaymodechange?: (mode: "full" | "compact") => void | Promise<void>;
    ontoolresultscollapsedchange?: (collapsed: boolean) => void | Promise<void>;
    onthinkingcollapsedchange?: (collapsed: boolean) => void | Promise<void>;
  }

  let {
    displayMode = "full",
    toolResultsCollapsedByDefault = true,
    thinkingCollapsedByDefault = true,
    isExtensionsLoading = false,
    extensionsLoadError = null,
    globalExtensions = [],
    localExtensions = [],
    extensionLoadDiagnostics = [],
    ondisplaymodechange,
    ontoolresultscollapsedchange,
    onthinkingcollapsedchange,
  }: Props = $props();

  const startupDisplayModeHint =
    "Select which chat surface Graphone should open in on startup.";
  const toolResultsCollapseHint =
    "When enabled, new tool result blocks start collapsed.";
  const thinkingCollapseHint =
    "When enabled, new thinking blocks start collapsed.";
  const extensionsHint =
    "Extensions loaded for the active session, grouped by global (~/.pi/agent) and local (.pi) scope.";

  const totalRegisteredExtensions = $derived(
    globalExtensions.length + localExtensions.length,
  );

  function formatExtensionMeta(extension: RegisteredExtensionSummary): string {
    const bits: string[] = [];
    if (extension.commandCount > 0) {
      bits.push(
        `${extension.commandCount} command${extension.commandCount === 1 ? "" : "s"}`,
      );
    }
    if (extension.toolCount > 0) {
      bits.push(
        `${extension.toolCount} tool${extension.toolCount === 1 ? "" : "s"}`,
      );
    }

    return bits.length > 0 ? bits.join(" • ") : "No commands or tools";
  }

  async function handleDisplayModeChange(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLSelectElement;
    const mode = target.value === "compact" ? "compact" : "full";
    await ondisplaymodechange?.(mode);
  }

  async function handleToolResultsCollapsedChange(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    await ontoolresultscollapsedchange?.(target.checked);
  }

  async function handleThinkingCollapsedChange(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    await onthinkingcollapsedchange?.(target.checked);
  }
</script>

<div
  class="absolute inset-0 z-30 flex flex-col bg-background/96 backdrop-blur-xs"
>
  <header
    class="shrink-0 h-[86px] border-b border-border flex items-center justify-center"
  >
    <h2
      class="text-3xl font-semibold tracking-tight bg-linear-to-r from-foreground to-muted-foreground bg-clip-text text-transparent"
    >
      Settings
    </h2>
  </header>

  <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
    <section class="rounded-lg border border-border bg-card/50 p-4">
      <h3 class="text-sm font-semibold text-foreground">Startup View</h3>

      <div class="mt-4">
        <label
          class="block text-xs font-medium text-foreground mb-1"
          for="display-mode-select"
          title={startupDisplayModeHint}
        >
          Display mode
        </label>
        <select
          id="display-mode-select"
          class="w-full max-w-xs rounded border border-border bg-input-background px-2.5 py-2 text-sm text-foreground focus:outline-none focus:border-ring"
          value={displayMode}
          onchange={handleDisplayModeChange}
          title={startupDisplayModeHint}
        >
          <option value="full">Full</option>
          <option value="compact">Compact</option>
        </select>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card/50 p-4">
      <h3 class="text-sm font-semibold text-foreground">Message Blocks</h3>

      <div class="mt-4 space-y-3">
        <label class="flex items-start gap-2.5" title={toolResultsCollapseHint}>
          <input
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-border"
            checked={toolResultsCollapsedByDefault}
            onchange={handleToolResultsCollapsedChange}
            title={toolResultsCollapseHint}
          />
          <span>
            <span class="block text-sm text-foreground"
              >Collapse tool results by default</span
            >
          </span>
        </label>

        <label class="flex items-start gap-2.5" title={thinkingCollapseHint}>
          <input
            type="checkbox"
            class="mt-0.5 h-4 w-4 rounded border-border"
            checked={thinkingCollapsedByDefault}
            onchange={handleThinkingCollapsedChange}
            title={thinkingCollapseHint}
          />
          <span>
            <span class="block text-sm text-foreground"
              >Collapse thinking blocks by default</span
            >
          </span>
        </label>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card/50 p-4">
      <div class="flex items-center justify-between gap-4">
        <h3
          class="text-sm font-semibold text-foreground"
          title={extensionsHint}
        >
          Extensions
        </h3>
        <span class="text-xs text-muted-foreground">
          {totalRegisteredExtensions} loaded
        </span>
      </div>

      {#if isExtensionsLoading}
        <p class="mt-3 text-xs text-muted-foreground">Loading extensions…</p>
      {:else}
        {#if extensionsLoadError}
          <p class="mt-3 text-xs text-destructive">
            Failed to load extensions: {extensionsLoadError}
          </p>
        {/if}

        <div class="mt-4 space-y-4">
          <div>
            <h4
              class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Global ({globalExtensions.length})
            </h4>
            {#if globalExtensions.length === 0}
              <p class="mt-2 text-xs text-muted-foreground">
                No global extensions.
              </p>
            {:else}
              <ul class="mt-2 space-y-2">
                {#each globalExtensions as extension (extension.resolvedPath)}
                  <li
                    class="rounded border border-border/70 bg-background/60 p-2.5"
                    title={extension.resolvedPath}
                  >
                    <p class="text-sm text-foreground">{extension.name}</p>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {formatExtensionMeta(extension)}
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          <div>
            <h4
              class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              Local ({localExtensions.length})
            </h4>
            {#if localExtensions.length === 0}
              <p class="mt-2 text-xs text-muted-foreground">
                No local extensions.
              </p>
            {:else}
              <ul class="mt-2 space-y-2">
                {#each localExtensions as extension (extension.resolvedPath)}
                  <li
                    class="rounded border border-border/70 bg-background/60 p-2.5"
                    title={extension.resolvedPath}
                  >
                    <p class="text-sm text-foreground">{extension.name}</p>
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {formatExtensionMeta(extension)}
                    </p>
                  </li>
                {/each}
              </ul>
            {/if}
          </div>

          {#if extensionLoadDiagnostics.length > 0}
            <details
              class="rounded border border-amber-500/30 bg-amber-500/5 p-2.5"
            >
              <summary
                class="cursor-pointer text-xs text-amber-700 dark:text-amber-300"
              >
                Extension diagnostics ({extensionLoadDiagnostics.length})
              </summary>
              <ul
                class="mt-2 space-y-2 text-xs text-amber-700 dark:text-amber-300"
              >
                {#each extensionLoadDiagnostics as diagnostic, idx (`${diagnostic.path}-${idx}`)}
                  <li>
                    <p class="font-medium break-all">{diagnostic.path}</p>
                    <p class="break-words">{diagnostic.error}</p>
                  </li>
                {/each}
              </ul>
            </details>
          {/if}
        </div>
      {/if}
    </section>
  </div>
</div>
