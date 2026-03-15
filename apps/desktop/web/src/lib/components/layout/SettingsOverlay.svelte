<script lang="ts">
  import type {
    AvailableSlashCommand,
    RegisteredExtensionSummary,
  } from "$lib/stores/agent.svelte";
  import type { UiTheme } from "$lib/theme/app-theme";

  interface Props {
    theme?: UiTheme;
    toolResultsCollapsedByDefault?: boolean;
    thinkingCollapsedByDefault?: boolean;
    runtimeSlashCommands?: AvailableSlashCommand[];
    isExtensionsLoading?: boolean;
    extensionsLoadError?: string | null;
    globalExtensions?: RegisteredExtensionSummary[];
    localExtensions?: RegisteredExtensionSummary[];
    extensionLoadDiagnostics?: Array<{ path: string; error: string }>;
    onthemechange?: (theme: UiTheme) => void | Promise<void>;
    ontoolresultscollapsedchange?: (collapsed: boolean) => void | Promise<void>;
    onthinkingcollapsedchange?: (collapsed: boolean) => void | Promise<void>;
  }

  let {
    theme = "dark",
    toolResultsCollapsedByDefault = true,
    thinkingCollapsedByDefault = true,
    runtimeSlashCommands = [],
    isExtensionsLoading = false,
    extensionsLoadError = null,
    globalExtensions = [],
    localExtensions = [],
    extensionLoadDiagnostics = [],
    onthemechange,
    ontoolresultscollapsedchange,
    onthinkingcollapsedchange,
  }: Props = $props();

  const appearanceHint =
    "Choose whether Graphone uses the light or dark theme.";
  const toolResultsCollapseHint =
    "When enabled, new tool result blocks start collapsed.";
  const thinkingCollapseHint =
    "When enabled, new thinking blocks start collapsed.";
  const skillsHint =
    "Skills loaded for the active session. These come from pi runtime resources and are available via /skill:name in the prompt box.";
  const promptsHint =
    "Prompt templates loaded for the active session. These come from pi runtime resources and are available via /name in the prompt box.";
  const extensionsHint =
    "Extensions loaded for the active session, grouped by global (~/.pi/agent) and local (.pi) scope.";

  const skills = $derived(
    runtimeSlashCommands.filter((command) => command.source === "skill"),
  );
  const globalSkills = $derived(
    skills.filter((skill) => skill.location === "user"),
  );
  const localSkills = $derived(
    skills.filter((skill) => skill.location === "project"),
  );
  const pathSkills = $derived(
    skills.filter(
      (skill) => skill.location === "path" || skill.location === undefined,
    ),
  );
  const totalSkills = $derived(skills.length);

  const promptTemplates = $derived(
    runtimeSlashCommands.filter((command) => command.source === "prompt"),
  );
  const globalPromptTemplates = $derived(
    promptTemplates.filter((prompt) => prompt.location === "user"),
  );
  const localPromptTemplates = $derived(
    promptTemplates.filter((prompt) => prompt.location === "project"),
  );
  const pathPromptTemplates = $derived(
    promptTemplates.filter(
      (prompt) => prompt.location === "path" || prompt.location === undefined,
    ),
  );
  const totalPromptTemplates = $derived(promptTemplates.length);
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

  async function handleThemeChange(event: Event): Promise<void> {
    const target = event.currentTarget as HTMLInputElement;
    if (
      target.checked &&
      (target.value === "light" || target.value === "dark")
    ) {
      await onthemechange?.(target.value);
    }
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

<div class="absolute inset-0 z-30 flex flex-col bg-overlay">
  <header
    class="shrink-0 h-[86px] border-b border-border flex items-center justify-center"
  >
    <h2 class="text-3xl font-semibold tracking-tight text-foreground">
      Settings
    </h2>
  </header>

  <div class="flex-1 min-h-0 overflow-y-auto p-6 space-y-6">
    <section class="rounded-lg border border-border bg-card p-4">
      <h3 class="text-sm font-semibold text-foreground" title={appearanceHint}>
        Appearance
      </h3>

      <div class="mt-4 grid gap-3 sm:grid-cols-2">
        <label
          class="flex items-start gap-2.5 rounded border border-border bg-surface p-3"
        >
          <input
            type="radio"
            name="theme"
            value="dark"
            class="mt-0.5 h-4 w-4 border-border"
            checked={theme === "dark"}
            onchange={handleThemeChange}
          />
          <span>
            <span class="block text-sm text-foreground">Dark</span>
            <span class="block text-xs text-muted-foreground">
              Dark surfaces with light text.
            </span>
          </span>
        </label>

        <label
          class="flex items-start gap-2.5 rounded border border-border bg-surface p-3"
        >
          <input
            type="radio"
            name="theme"
            value="light"
            class="mt-0.5 h-4 w-4 border-border"
            checked={theme === "light"}
            onchange={handleThemeChange}
          />
          <span>
            <span class="block text-sm text-foreground">Light</span>
            <span class="block text-xs text-muted-foreground">
              Light surfaces with dark text.
            </span>
          </span>
        </label>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
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

    <section class="rounded-lg border border-border bg-card p-4">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-sm font-semibold text-foreground" title={skillsHint}>
          Skills
        </h3>
        <span class="text-xs text-muted-foreground">{totalSkills} loaded</span>
      </div>

      <div class="mt-4 space-y-4">
        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Global ({globalSkills.length})
          </h4>
          {#if globalSkills.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">No global skills.</p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each globalSkills as skill (`${skill.name}-${skill.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={skill.path}
                >
                  <p class="text-sm text-foreground">/{skill.name}</p>
                  {#if skill.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {skill.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Local ({localSkills.length})
          </h4>
          {#if localSkills.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">No local skills.</p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each localSkills as skill (`${skill.name}-${skill.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={skill.path}
                >
                  <p class="text-sm text-foreground">/{skill.name}</p>
                  {#if skill.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {skill.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Path / package ({pathSkills.length})
          </h4>
          {#if pathSkills.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              No path- or package-based skills.
            </p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each pathSkills as skill (`${skill.name}-${skill.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={skill.path}
                >
                  <p class="text-sm text-foreground">/{skill.name}</p>
                  {#if skill.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {skill.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
      <div class="flex items-center justify-between gap-4">
        <h3 class="text-sm font-semibold text-foreground" title={promptsHint}>
          Prompts
        </h3>
        <span class="text-xs text-muted-foreground">
          {totalPromptTemplates} loaded
        </span>
      </div>

      <div class="mt-4 space-y-4">
        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Global ({globalPromptTemplates.length})
          </h4>
          {#if globalPromptTemplates.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              No global prompt templates.
            </p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each globalPromptTemplates as prompt (`${prompt.name}-${prompt.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={prompt.path}
                >
                  <p class="text-sm text-foreground">/{prompt.name}</p>
                  {#if prompt.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {prompt.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Local ({localPromptTemplates.length})
          </h4>
          {#if localPromptTemplates.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              No local prompt templates.
            </p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each localPromptTemplates as prompt (`${prompt.name}-${prompt.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={prompt.path}
                >
                  <p class="text-sm text-foreground">/{prompt.name}</p>
                  {#if prompt.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {prompt.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>

        <div>
          <h4
            class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          >
            Path / package ({pathPromptTemplates.length})
          </h4>
          {#if pathPromptTemplates.length === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              No path- or package-based prompt templates.
            </p>
          {:else}
            <ul class="mt-2 space-y-2">
              {#each pathPromptTemplates as prompt (`${prompt.name}-${prompt.path}`)}
                <li
                  class="rounded border border-border bg-surface p-2.5"
                  title={prompt.path}
                >
                  <p class="text-sm text-foreground">/{prompt.name}</p>
                  {#if prompt.description}
                    <p class="mt-1 text-[11px] text-muted-foreground">
                      {prompt.description}
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </div>
    </section>

    <section class="rounded-lg border border-border bg-card p-4">
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
                    class="rounded border border-border bg-surface p-2.5"
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
                    class="rounded border border-border bg-surface p-2.5"
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
              class="rounded border border-amber-600 dark:border-amber-500 bg-warning-surface p-2.5"
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
