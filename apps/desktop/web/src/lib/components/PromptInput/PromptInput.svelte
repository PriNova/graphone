<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { cn } from "$lib/utils/cn";
  import { parseBangCommand } from "$lib/handlers/commands";
  import {
    parseSlashCommand,
    isKnownSlashCommand,
    ALL_SLASH_COMMANDS,
    getCommandHandler,
    type SlashCommand,
  } from "$lib/slash-commands";
  import type { AvailableSlashCommand } from "$lib/stores/agent.svelte";
  import {
    MAX_IMAGES_PER_MESSAGE,
    areAttachmentsEqual,
    areLocalAndExternalEqual,
    processImageFiles,
    toExternalAttachments,
    toLocalAttachments,
    tryReadNativeClipboardImage,
    extractImageFilesFromClipboard,
    type LocalPromptImageAttachment,
  } from "$lib/utils/image-attachments";
  import SlashCommandAutocomplete from "./SlashCommandAutocomplete.svelte";
  import BangCommandIndicator from "./BangCommandIndicator.svelte";
  import ModelSelector from "./ModelSelector.svelte";
  import ThinkingSelector from "./ThinkingSelector.svelte";
  import type { AvailableModel, ThinkingLevel } from "$lib/stores/agent.svelte";
  import type { EnabledModelsStore } from "$lib/stores/enabledModels.svelte";
  import type { PromptImageAttachment } from "$lib/types/agent";

  type FilterMode = "all" | "enabled";

  interface Props {
    value?: string;
    onsubmit?: (
      value: string,
      images?: PromptImageAttachment[],
    ) => void | Promise<void>;
    oninput?: (value: string) => void;
    attachments?: PromptImageAttachment[];
    onattachmentschange?: (images: PromptImageAttachment[]) => void;
    oncancel?: () => void;
    onslashcommand?: (
      command: string,
      args: string,
      fullText: string,
    ) => void | Promise<void>;
    onnewchat?: () => void | Promise<void>;
    onmodelchange?: (provider: string, modelId: string) => void | Promise<void>;
    onthinkingchange?: (level: ThinkingLevel) => void | Promise<void>;
    onmodelfilterchange?: (mode: FilterMode) => void | Promise<void>;
    slashCommands?: SlashCommand[];
    runtimeCommands?: AvailableSlashCommand[];
    placeholder?: string;
    disabled?: boolean;
    autofocus?: boolean;
    isLoading?: boolean;
    model?: string;
    provider?: string;
    thinkingLevel?: ThinkingLevel;
    supportsThinking?: boolean;
    supportsImageInput?: boolean;
    availableThinkingLevels?: ThinkingLevel[];
    models?: AvailableModel[];
    modelsLoading?: boolean;
    modelChanging?: boolean;
    thinkingChanging?: boolean;
    enabledModels?: EnabledModelsStore;
    modelFilter?: FilterMode;
    chatHasMessages?: boolean;
    compact?: boolean;
  }

  let {
    value: externalValue = "",
    attachments: externalAttachments = [],
    onsubmit,
    oninput,
    onattachmentschange,
    oncancel,
    onslashcommand,
    onnewchat,
    onmodelchange,
    onthinkingchange,
    onmodelfilterchange,
    slashCommands = ALL_SLASH_COMMANDS,
    runtimeCommands = [],
    placeholder = "Ask anything...",
    disabled = false,
    autofocus = false,
    isLoading = false,
    model = "",
    provider = "",
    thinkingLevel = "off",
    supportsThinking = false,
    supportsImageInput = false,
    availableThinkingLevels = ["off"],
    models = [],
    modelsLoading = false,
    modelChanging = false,
    thinkingChanging = false,
    enabledModels,
    modelFilter = "all",
    chatHasMessages = false,
    compact = false,
  }: Props = $props();

  // ── Internal state ────────────────────────────────────────────────────────

  // svelte-ignore state_referenced_locally
  let internalValue = $state(externalValue);
  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let isFocused = $state(false);
  let commandJustSelected = $state(false);
  let attachments = $state<LocalPromptImageAttachment[]>([]);
  let attachmentError = $state<string | null>(null);
  let isDragOver = $state(false);
  let dragDepth = $state(0);
  let selectedCommandIndex = $state(0);
  let lastSyncedExternalValue = $state<string | null>(null);
  let lastSyncedExternalAttachments = $state<PromptImageAttachment[] | null>(
    null,
  );

  // ── Derived state ─────────────────────────────────────────────────────────

  const hasContent = $derived(internalValue.trim().length > 0);
  const hasAttachments = $derived(attachments.length > 0);
  const submitBlockedByModel = $derived(hasAttachments && !supportsImageInput);
  const canSubmit = $derived(
    (hasContent || hasAttachments) &&
      !disabled &&
      !isLoading &&
      !submitBlockedByModel,
  );
  const canCancel = $derived(isLoading);
  const canStartNewChat = $derived(!disabled && chatHasMessages);
  const modelSelectorDisabled = $derived(
    disabled || isLoading || modelChanging,
  );
  const thinkingSelectorDisabled = $derived(
    disabled || isLoading || modelChanging || thinkingChanging,
  );

  const parsedCommand = $derived(parseSlashCommand(internalValue));
  const isSlashCommand = $derived(parsedCommand !== null);
  const isKnownCommand = $derived(
    parsedCommand
      ? isKnownSlashCommand(parsedCommand.command, runtimeCommands)
      : false,
  );
  const commandHandler = $derived(
    parsedCommand
      ? getCommandHandler(parsedCommand.command, runtimeCommands)
      : null,
  );
  const matchedCommand = $derived.by(() => {
    if (!parsedCommand) return null;
    return (
      slashCommands.find((command) => command.name === parsedCommand.command) ??
      null
    );
  });

  const bangPrefixMode = $derived.by(() => {
    const trimmed = internalValue.trim();
    if (trimmed.startsWith("!!")) return "exclude" as const;
    if (trimmed.startsWith("!")) return "include" as const;
    return null;
  });

  const parsedBangCommand = $derived(parseBangCommand(internalValue));

  const matchingCommands = $derived.by(() => {
    if (!isFocused || !isSlashCommand) return [];
    if (!parsedCommand || parsedCommand.args) return [];
    if (internalValue.endsWith(" ")) return [];
    if (commandJustSelected) return [];
    const query = parsedCommand.command.toLowerCase();
    return slashCommands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(query),
    );
  });

  // Reset selection when matching commands change
  $effect(() => {
    if (matchingCommands.length > 0) {
      selectedCommandIndex = 0;
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function applyTextareaHeight(target: HTMLTextAreaElement): void {
    target.style.height = "auto";
    const newHeight = Math.min(target.scrollHeight, 300);
    target.style.height = newHeight > 44 ? `${newHeight}px` : "auto";
  }

  function setInternalValue(nextValue: string, notify = true): void {
    internalValue = nextValue;
    if (notify) oninput?.(nextValue);
  }

  function setAttachments(
    nextAttachments: LocalPromptImageAttachment[],
    notify = true,
  ): void {
    // Use the generic equality check from the utility
    if (areAttachmentsEqual(attachments, nextAttachments)) return;

    attachments = nextAttachments;

    if (!notify) return;

    const externalImages = toExternalAttachments(nextAttachments);
    lastSyncedExternalAttachments = externalImages;
    onattachmentschange?.(externalImages);
  }

  function selectCommand(cmd: SlashCommand): void {
    commandJustSelected = true;
    setInternalValue(`/${cmd.name} `);
    textareaRef?.focus();
    setTimeout(() => {
      commandJustSelected = false;
    }, 100);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  function handleInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    setInternalValue(target.value);
    applyTextareaHeight(target);
  }

  function clearAttachmentError(): void {
    attachmentError = null;
  }

  function setAttachmentError(message: string): void {
    attachmentError = message;
  }

  function removeAttachment(id: string): void {
    const nextAttachments = attachments.filter((image) => image.id !== id);
    setAttachments(nextAttachments);
    if (nextAttachments.length === 0) clearAttachmentError();
  }

  async function addImageFiles(files: Blob[]): Promise<void> {
    if (disabled || isLoading) return;

    const result = await processImageFiles(files, attachments.length);

    if (result.error) {
      setAttachmentError(result.error);
      return;
    }

    setAttachments([...attachments, ...result.attachments]);
    clearAttachmentError();
  }

  function handlePaste(event: ClipboardEvent): void {
    if (disabled || isLoading) return;

    const items = event.clipboardData?.items;
    if (!items || items.length === 0) {
      // Fall back to native clipboard reading
      void (async () => {
        const blob = await tryReadNativeClipboardImage(invoke);
        if (blob) await addImageFiles([blob]);
      })();
      return;
    }

    const imageFiles = extractImageFilesFromClipboard(items);

    if (imageFiles.length === 0) {
      const hasTextPayload =
        (event.clipboardData?.getData("text/plain") ?? "").length > 0 ||
        (event.clipboardData?.getData("text/html") ?? "").length > 0;
      if (!hasTextPayload) {
        void (async () => {
          const blob = await tryReadNativeClipboardImage(invoke);
          if (blob) await addImageFiles([blob]);
        })();
      }
      return;
    }

    event.preventDefault();
    void addImageFiles(imageFiles);
  }

  function handleDragEnter(event: DragEvent): void {
    if (disabled || isLoading) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    isDragOver = true;
  }

  function handleDragOver(event: DragEvent): void {
    if (disabled || isLoading) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    isDragOver = true;
  }

  function handleDragLeave(event: DragEvent): void {
    if (disabled || isLoading) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) isDragOver = false;
  }

  function handleDrop(event: DragEvent): void {
    if (disabled || isLoading) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    isDragOver = false;

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );

    if (files.length > 0) void addImageFiles(files);
  }

  function openFilePicker(): void {
    if (disabled || isLoading) return;
    fileInputRef?.click();
  }

  function handleFileInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files ?? []).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );

    if (files.length > 0) void addImageFiles(files);

    // Allow selecting the same file again later
    target.value = "";
  }

  async function handleSubmit(): Promise<void> {
    if (!canSubmit) return;

    const trimmedValue = internalValue.trim();
    if (!trimmedValue && attachments.length === 0) return;

    const slashCmd = parseSlashCommand(trimmedValue);
    if (slashCmd && onslashcommand) {
      await onslashcommand(slashCmd.command, slashCmd.args, trimmedValue);
    } else {
      await onsubmit?.(trimmedValue, toExternalAttachments(attachments));
    }

    setInternalValue("");
    setAttachments([]);
    clearAttachmentError();
    if (textareaRef) textareaRef.style.height = "auto";
  }

  async function handleNewChat(): Promise<void> {
    if (!canStartNewChat) return;

    if (onnewchat) {
      await onnewchat();
      return;
    }

    if (onslashcommand) {
      await onslashcommand("new", "", "/new");
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    // Handle dropdown navigation when slash command dropdown is open
    if (matchingCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedCommandIndex =
          (selectedCommandIndex + 1) % matchingCommands.length;
        return;
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedCommandIndex =
          (selectedCommandIndex - 1 + matchingCommands.length) %
          matchingCommands.length;
        return;
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selectedCmd = matchingCommands[selectedCommandIndex];
        if (selectedCmd) selectCommand(selectedCmd);
        return;
      } else if (event.key === "Escape") {
        event.preventDefault();
        isFocused = false;
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) handleSubmit();
    } else if (event.key === "Escape") {
      if (isLoading) {
        oncancel?.();
      } else {
        setInternalValue("");
        setAttachments([]);
        clearAttachmentError();
        if (textareaRef) textareaRef.style.height = "auto";
      }
    }
  }

  // ── Sync external state ───────────────────────────────────────────────────

  $effect(() => {
    if (lastSyncedExternalValue === null) {
      lastSyncedExternalValue = externalValue;
      return;
    }

    if (externalValue === lastSyncedExternalValue) return;

    lastSyncedExternalValue = externalValue;
    internalValue = externalValue;
    if (textareaRef) applyTextareaHeight(textareaRef);
  });

  $effect(() => {
    if (lastSyncedExternalAttachments === null) {
      lastSyncedExternalAttachments = externalAttachments;

      if (!areLocalAndExternalEqual(attachments, externalAttachments)) {
        setAttachments(toLocalAttachments(externalAttachments), false);
      }

      if (externalAttachments.length === 0) clearAttachmentError();
      return;
    }

    if (areAttachmentsEqual(externalAttachments, lastSyncedExternalAttachments))
      return;

    lastSyncedExternalAttachments = externalAttachments;

    if (!areLocalAndExternalEqual(attachments, externalAttachments)) {
      setAttachments(toLocalAttachments(externalAttachments), false);
    }

    if (externalAttachments.length === 0) clearAttachmentError();
  });

  // Auto-focus on mount if requested
  $effect(() => {
    if (autofocus && textareaRef) textareaRef.focus();
  });
</script>

<div
  class={cn(
    "flex flex-col w-full mx-auto relative",
    disabled && "opacity-60 cursor-not-allowed",
  )}
>
  <!-- Slash command autocomplete -->
  <SlashCommandAutocomplete
    isOpen={!!(
      isFocused &&
      (matchingCommands.length > 0 ||
        (isSlashCommand &&
          parsedCommand &&
          !parsedCommand.args &&
          !internalValue.endsWith(" ")))
    )}
    {matchingCommands}
    {selectedCommandIndex}
    {isKnownCommand}
    {commandHandler}
    {matchedCommand}
    {parsedCommand}
    onselectcommand={selectCommand}
    onindexchange={(index) => (selectedCommandIndex = index)}
  />

  <input
    bind:this={fileInputRef}
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    multiple
    class="hidden"
    onchange={handleFileInputChange}
  />

  <div
    class={cn(
      "flex flex-col w-full bg-surface border border-input-border rounded-md transition-all duration-100 overflow-hidden relative",
      isFocused && "bg-surface-hover border-ring",
      isDragOver && "border-primary bg-surface-active",
      isSlashCommand &&
        isKnownCommand &&
        commandHandler === "local" &&
        "border-success",
      isSlashCommand &&
        isKnownCommand &&
        commandHandler === "unimplemented" &&
        "border-yellow-600 dark:border-yellow-500",
      isSlashCommand && !isKnownCommand && "border-destructive",
      isLoading && "bg-surface-active border-primary",
    )}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="group"
  >
    {#if isDragOver}
      <div
        class="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-overlay"
      >
        <span
          class="px-3 py-1 rounded border border-primary bg-surface-active text-xs text-primary"
        >
          Drop images to attach
        </span>
      </div>
    {/if}

    {#if attachments.length > 0}
      <div class="px-3 pt-3 pb-1 flex flex-wrap gap-2 border-b border-border">
        {#each attachments as image (image.id)}
          <div
            class="relative w-14 h-14 rounded overflow-hidden border border-border"
          >
            <img
              src={`data:${image.mimeType};base64,${image.data}`}
              alt="Attachment preview"
              class="w-full h-full object-cover"
            />
            <button
              type="button"
              class="absolute top-0 right-0 w-5 h-5 text-[10px] bg-black text-white hover:bg-neutral-800"
              onclick={() => removeAttachment(image.id)}
              aria-label="Remove image attachment"
              title="Remove"
            >
              ×
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="relative">
      {#if bangPrefixMode}
        <BangCommandIndicator
          mode={bangPrefixMode}
          isValid={parsedBangCommand !== null}
        />
      {/if}

      <textarea
        bind:this={textareaRef}
        bind:value={internalValue}
        {placeholder}
        {disabled}
        class={cn(
          "w-full min-h-11 max-h-[40vh] px-4 pr-32 bg-transparent border-none outline-none resize-none text-foreground overflow-y-auto text-base leading-6",
          bangPrefixMode ? "pt-1 pb-2.5" : "py-2.5",
          "placeholder:text-muted-foreground/60",
          disabled && "cursor-not-allowed",
        )}
        rows="1"
        oninput={handleInput}
        onkeydown={handleKeyDown}
        onpaste={handlePaste}
        onfocus={() => (isFocused = true)}
        onblur={() => (isFocused = false)}
      ></textarea>

      <div
        class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1.5"
      >
        <button
          type="button"
          class={cn(
            "flex items-center justify-center w-8 h-8 p-0 rounded border transition-all duration-150",
            !disabled && !isLoading
              ? "bg-card border-border text-muted-foreground hover:bg-secondary hover:border-foreground hover:text-foreground cursor-pointer"
              : "bg-card border-border text-muted-foreground cursor-not-allowed opacity-50",
          )}
          disabled={disabled || isLoading}
          onclick={openFilePicker}
          aria-label="Attach image"
          title="Attach image"
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21.44 11.05l-8.49 8.49a6 6 0 01-8.49-8.49l8.49-8.49a4 4 0 115.66 5.66l-8.48 8.49a2 2 0 01-2.83-2.83l7.78-7.78"
            />
          </svg>
        </button>

        <button
          type="button"
          class={cn(
            "flex items-center justify-center w-8 h-8 p-0 rounded border transition-all duration-150",
            canStartNewChat
              ? "bg-card border-border text-muted-foreground hover:bg-secondary hover:border-foreground hover:text-foreground cursor-pointer"
              : "bg-card border-border text-muted-foreground cursor-not-allowed opacity-50",
          )}
          disabled={!canStartNewChat}
          onclick={handleNewChat}
          aria-label="Start new chat"
          title={canStartNewChat
            ? "Start new chat"
            : "New chat is available when the chat has messages"}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 5v14M5 12h14"
            />
          </svg>
        </button>

        <button
          type="button"
          class={cn(
            "flex items-center justify-center w-8 h-8 p-0 rounded cursor-pointer transition-all duration-150",
            isLoading
              ? "bg-destructive border-destructive text-destructive-foreground hover:bg-destructive"
              : "bg-card border border-border text-muted-foreground hover:not-disabled:bg-secondary hover:not-disabled:border-foreground hover:not-disabled:text-foreground",
            !isLoading &&
              (hasContent || hasAttachments) &&
              !submitBlockedByModel &&
              "bg-primary border-primary text-primary-foreground hover:not-disabled:opacity-90",
            !canSubmit && !canCancel && "opacity-40 cursor-not-allowed",
          )}
          disabled={!canSubmit && !canCancel}
          onclick={isLoading ? () => oncancel?.() : handleSubmit}
          aria-label={isLoading ? "Stop" : "Submit"}
        >
          {#if isLoading}
            <svg
              class="w-4 h-4"
              viewBox="0 0 24 24"
              fill="currentColor"
              stroke="none"
            >
              <rect x="6" y="6" width="12" height="12" rx="1" />
            </svg>
          {:else}
            <svg
              class="w-4 h-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 12h14M12 5l7 7-7 7"
              />
            </svg>
          {/if}
        </button>
      </div>
    </div>
  </div>

  {#if !compact}
    <div class="flex justify-between pt-1.5 px-1">
      <span class="text-xs flex flex-col gap-0.5">
        {#if isSlashCommand && parsedCommand}
          {#if isKnownCommand && matchedCommand}
            {#if commandHandler === "local"}
              <span class="text-success font-medium"
                >/{parsedCommand.command}</span
              >
              <span class="text-muted-foreground ml-1">
                {matchedCommand.description}
              </span>
            {:else if commandHandler === "unimplemented"}
              <span class="text-warning font-medium"
                >/{parsedCommand.command}</span
              >
              <span class="text-muted-foreground ml-1">
                Not yet implemented • {matchedCommand.description}
              </span>
            {:else}
              <span class="text-primary font-medium"
                >/{parsedCommand.command}</span
              >
              <span class="text-muted-foreground ml-1">
                {matchedCommand.description}
              </span>
            {/if}
          {:else}
            <span class="text-destructive">/{parsedCommand.command}</span>
            <span class="text-muted-foreground ml-1">Unknown command</span>
          {/if}
        {/if}

        {#if attachments.length > 0}
          <span class="text-muted-foreground ml-1">
            {attachments.length}/{MAX_IMAGES_PER_MESSAGE} image{attachments.length ===
            1
              ? ""
              : "s"}
          </span>
        {/if}

        {#if submitBlockedByModel}
          <span class="text-warning ml-1">
            Current model does not support image input. Remove images or switch
            models.
          </span>
        {/if}

        {#if attachmentError}
          <span class="text-destructive ml-1">{attachmentError}</span>
        {/if}
      </span>
      <span
        class="text-xs text-muted-foreground/70 text-right flex items-center gap-2"
      >
        <ModelSelector
          {models}
          currentModel={model}
          currentProvider={provider}
          loading={modelsLoading}
          changing={modelChanging}
          disabled={modelSelectorDisabled}
          {enabledModels}
          filterMode={modelFilter}
          onchange={onmodelchange}
          onfilterchange={onmodelfilterchange}
        />
        <ThinkingSelector
          level={thinkingLevel}
          {supportsThinking}
          availableLevels={availableThinkingLevels}
          changing={thinkingChanging}
          disabled={thinkingSelectorDisabled}
          onchange={onthinkingchange}
        />
      </span>
    </div>
  {/if}
</div>
