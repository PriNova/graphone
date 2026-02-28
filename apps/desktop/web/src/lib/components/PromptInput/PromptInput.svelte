<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { cn } from "$lib/utils/cn";
  import {
    parseSlashCommand,
    isKnownSlashCommand,
    ALL_SLASH_COMMANDS,
    getCommandHandler,
  } from "$lib/slash-commands";
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

  type LocalPromptImageAttachment = PromptImageAttachment & { id: string };

  function toLocalAttachments(
    images: PromptImageAttachment[],
  ): LocalPromptImageAttachment[] {
    return images.map((image) => ({
      id: crypto.randomUUID(),
      ...image,
    }));
  }

  function toExternalAttachments(
    images: LocalPromptImageAttachment[],
  ): PromptImageAttachment[] {
    return images.map(({ id, ...image }) => image);
  }

  function areExternalAttachmentsEqual(
    a: PromptImageAttachment[] | null | undefined,
    b: PromptImageAttachment[] | null | undefined,
  ): boolean {
    if (a === b) {
      return true;
    }

    if (!a || !b) {
      return false;
    }

    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i += 1) {
      const left = a[i];
      const right = b[i];

      if (!left || !right) {
        return false;
      }

      if (left.mimeType !== right.mimeType || left.data !== right.data) {
        return false;
      }
    }

    return true;
  }

  function areLocalAttachmentsEqual(
    a: LocalPromptImageAttachment[],
    b: LocalPromptImageAttachment[],
  ): boolean {
    if (a === b) {
      return true;
    }

    if (a.length !== b.length) {
      return false;
    }

    for (let i = 0; i < a.length; i += 1) {
      const left = a[i];
      const right = b[i];

      if (!left || !right) {
        return false;
      }

      if (
        left.id !== right.id ||
        left.mimeType !== right.mimeType ||
        left.data !== right.data
      ) {
        return false;
      }
    }

    return true;
  }

  function areLocalAndExternalAttachmentsEqual(
    localImages: LocalPromptImageAttachment[],
    externalImages: PromptImageAttachment[],
  ): boolean {
    if (localImages.length !== externalImages.length) {
      return false;
    }

    for (let i = 0; i < localImages.length; i += 1) {
      const local = localImages[i];
      const external = externalImages[i];

      if (!local || !external) {
        return false;
      }

      if (
        local.mimeType !== external.mimeType ||
        local.data !== external.data
      ) {
        return false;
      }
    }

    return true;
  }

  // Internal state for the input value
  // svelte-ignore state_referenced_locally
  let internalValue = $state(externalValue);

  const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  const MAX_IMAGES_PER_MESSAGE = 4;
  const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

  let textareaRef = $state<HTMLTextAreaElement | null>(null);
  let fileInputRef = $state<HTMLInputElement | null>(null);
  let isFocused = $state(false);
  let commandJustSelected = $state(false);
  let attachments = $state<LocalPromptImageAttachment[]>([]);
  let attachmentError = $state<string | null>(null);
  let isDragOver = $state(false);
  let dragDepth = $state(0);

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

  // Slash command detection
  const parsedCommand = $derived(parseSlashCommand(internalValue));
  const isSlashCommand = $derived(parsedCommand !== null);
  const isKnownCommand = $derived(
    parsedCommand ? isKnownSlashCommand(parsedCommand.command) : false,
  );
  const commandHandler = $derived(
    parsedCommand ? getCommandHandler(parsedCommand.command) : null,
  );

  // Filter matching commands for autocomplete (show all matches, scrollable)
  const matchingCommands = $derived.by(() => {
    if (!isFocused || !isSlashCommand) return [];
    if (!parsedCommand || parsedCommand.args) return [];
    // Don't show dropdown if input ends with space (command is complete/selected)
    if (internalValue.endsWith(" ")) return [];
    // Don't show dropdown immediately after selecting a command
    if (commandJustSelected) return [];
    const query = parsedCommand.command.toLowerCase();
    return ALL_SLASH_COMMANDS.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(query),
    );
  });

  // Track selected command index for keyboard navigation
  let selectedCommandIndex = $state(0);

  // Reset selection when matching commands change
  $effect(() => {
    if (matchingCommands.length > 0) {
      selectedCommandIndex = 0;
    }
  });

  function applyTextareaHeight(target: HTMLTextAreaElement): void {
    target.style.height = "auto";
    const newHeight = Math.min(target.scrollHeight, 300);
    target.style.height = newHeight > 44 ? `${newHeight}px` : "auto";
  }

  let lastSyncedExternalAttachments = $state<PromptImageAttachment[] | null>(
    null,
  );

  function setInternalValue(nextValue: string, notify = true): void {
    internalValue = nextValue;
    if (notify) {
      oninput?.(nextValue);
    }
  }

  function setAttachments(
    nextAttachments: LocalPromptImageAttachment[],
    notify = true,
  ): void {
    if (areLocalAttachmentsEqual(attachments, nextAttachments)) {
      return;
    }

    attachments = nextAttachments;

    if (!notify) {
      return;
    }

    const externalImages = toExternalAttachments(nextAttachments);
    lastSyncedExternalAttachments = externalImages;
    onattachmentschange?.(externalImages);
  }

  function selectCommand(cmd: (typeof ALL_SLASH_COMMANDS)[0]) {
    // Set flag to prevent dropdown from reopening immediately
    commandJustSelected = true;
    // Update value with trailing space to prevent dropdown from reopening
    setInternalValue(`/${cmd.name} `);
    // Re-focus textarea
    textareaRef?.focus();
    // Clear the flag after a short delay to allow future slash commands
    setTimeout(() => {
      commandJustSelected = false;
    }, 100);
  }

  function handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    setInternalValue(target.value);

    // Auto-resize textarea based on content.
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
    if (nextAttachments.length === 0) {
      clearAttachmentError();
    }
  }

  function isSupportedImageMimeType(mimeType: string): boolean {
    return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
  }

  function readBlobAsDataUrl(file: Blob): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onerror = () => resolve(null);
      reader.onload = (event) => {
        const result = event.target?.result;
        resolve(typeof result === "string" ? result : null);
      };
      reader.readAsDataURL(file);
    });
  }

  async function convertDataUrlToPng(dataUrl: string): Promise<string | null> {
    const image = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });

    if (!image) {
      return null;
    }

    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  }

  async function processImageFile(file: Blob): Promise<void> {
    if (disabled || isLoading) {
      return;
    }

    if (attachments.length >= MAX_IMAGES_PER_MESSAGE) {
      setAttachmentError(
        `You can only attach up to ${MAX_IMAGES_PER_MESSAGE} images per message.`,
      );
      return;
    }

    const mimeType = file.type.toLowerCase();
    if (!mimeType.startsWith("image/")) {
      setAttachmentError("Only image files can be attached.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setAttachmentError("Image is too large. Maximum size is 5MB.");
      return;
    }

    let dataUrl = await readBlobAsDataUrl(file);
    if (!dataUrl) {
      setAttachmentError("Failed to read image attachment.");
      return;
    }

    if (!isSupportedImageMimeType(mimeType)) {
      const converted = await convertDataUrlToPng(dataUrl);
      if (!converted) {
        setAttachmentError(
          "Only PNG, JPEG, GIF, and WebP images are supported.",
        );
        return;
      }
      dataUrl = converted;
    }

    const commaIndex = dataUrl.indexOf(",");
    const header = commaIndex > 0 ? dataUrl.slice(0, commaIndex) : "";
    const base64Data = commaIndex > 0 ? dataUrl.slice(commaIndex + 1) : "";
    if (
      !header.startsWith("data:") ||
      !header.includes(";base64") ||
      base64Data.length === 0
    ) {
      setAttachmentError("Unsupported clipboard image format.");
      return;
    }

    const declaredMimeType = header
      .slice("data:".length)
      .split(";")[0]
      ?.toLowerCase();
    const resolvedMimeType =
      declaredMimeType && isSupportedImageMimeType(declaredMimeType)
        ? declaredMimeType
        : "image/png";

    setAttachments([
      ...attachments,
      {
        id: crypto.randomUUID(),
        type: "image",
        data: base64Data,
        mimeType: resolvedMimeType,
      },
    ]);
    clearAttachmentError();
  }

  async function processImageFiles(files: Blob[]): Promise<void> {
    for (const file of files) {
      await processImageFile(file);
      if (attachments.length >= MAX_IMAGES_PER_MESSAGE) {
        return;
      }
    }
  }

  function decodeBase64ToBytes(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i += 1) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  async function tryNativeClipboardImagePaste(): Promise<boolean> {
    try {
      const image = await invoke<PromptImageAttachment | null>(
        "read_clipboard_image",
      );
      if (
        !image ||
        image.type !== "image" ||
        typeof image.data !== "string" ||
        typeof image.mimeType !== "string"
      ) {
        return false;
      }

      const bytes = decodeBase64ToBytes(image.data);
      if (bytes.length === 0) {
        return false;
      }

      const blob = new Blob([bytes], {
        type: image.mimeType,
      });
      await processImageFile(blob);
      return true;
    } catch {
      return false;
    }
  }

  function handlePaste(event: ClipboardEvent): void {
    if (disabled || isLoading) {
      return;
    }

    const items = event.clipboardData?.items;
    if (!items || items.length === 0) {
      void tryNativeClipboardImagePaste();
      return;
    }

    const imageItems = Array.from(items).filter(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );

    if (imageItems.length === 0) {
      const hasTextPayload =
        (event.clipboardData.getData("text/plain") ?? "").length > 0 ||
        (event.clipboardData.getData("text/html") ?? "").length > 0;
      if (!hasTextPayload) {
        void tryNativeClipboardImagePaste();
      }
      return;
    }

    event.preventDefault();
    void processImageFiles(
      imageItems
        .map((item) => item.getAsFile())
        .filter((file): file is File => file !== null),
    );
  }

  function handleDragEnter(event: DragEvent): void {
    if (disabled || isLoading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepth += 1;
    isDragOver = true;
  }

  function handleDragOver(event: DragEvent): void {
    if (disabled || isLoading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    isDragOver = true;
  }

  function handleDragLeave(event: DragEvent): void {
    if (disabled || isLoading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      isDragOver = false;
    }
  }

  function handleDrop(event: DragEvent): void {
    if (disabled || isLoading) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dragDepth = 0;
    isDragOver = false;

    const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );

    if (files.length === 0) {
      return;
    }

    void processImageFiles(files);
  }

  function openFilePicker(): void {
    if (disabled || isLoading) {
      return;
    }

    fileInputRef?.click();
  }

  function handleFileInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const files = Array.from(target.files ?? []).filter((file) =>
      file.type.toLowerCase().startsWith("image/"),
    );

    if (files.length > 0) {
      void processImageFiles(files);
    }

    // Allow selecting the same file again later.
    target.value = "";
  }

  async function handleSubmit() {
    if (!canSubmit) return;

    const trimmedValue = internalValue.trim();
    if (!trimmedValue && attachments.length === 0) return;

    // Check if this is a slash command
    const slashCmd = parseSlashCommand(trimmedValue);
    if (slashCmd && onslashcommand) {
      await onslashcommand(slashCmd.command, slashCmd.args, trimmedValue);
    } else {
      await onsubmit?.(
        trimmedValue,
        attachments.map(({ id, ...image }) => image),
      );
    }

    // Clear input after submission
    setInternalValue("");
    setAttachments([]);
    clearAttachmentError();
    if (textareaRef) {
      textareaRef.style.height = "auto";
    }
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

  function handleKeyDown(event: KeyboardEvent) {
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
        // Select the highlighted command
        event.preventDefault();
        const selectedCmd = matchingCommands[selectedCommandIndex];
        if (selectedCmd) {
          selectCommand(selectedCmd);
        }
        return;
      } else if (event.key === "Escape") {
        // Close dropdown but keep typing
        event.preventDefault();
        isFocused = false;
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        handleSubmit();
      }
    } else if (event.key === "Escape") {
      if (isLoading) {
        oncancel?.();
      } else {
        setInternalValue("");
        setAttachments([]);
        clearAttachmentError();
        if (textareaRef) {
          textareaRef.style.height = "auto";
        }
      }
    }
  }

  let lastSyncedExternalValue = $state<string | null>(null);

  $effect(() => {
    if (lastSyncedExternalValue === null) {
      lastSyncedExternalValue = externalValue;
      return;
    }

    if (externalValue === lastSyncedExternalValue) {
      return;
    }

    lastSyncedExternalValue = externalValue;
    internalValue = externalValue;
    if (textareaRef) {
      applyTextareaHeight(textareaRef);
    }
  });

  $effect(() => {
    if (lastSyncedExternalAttachments === null) {
      lastSyncedExternalAttachments = externalAttachments;

      if (
        !areLocalAndExternalAttachmentsEqual(attachments, externalAttachments)
      ) {
        setAttachments(toLocalAttachments(externalAttachments), false);
      }

      if (externalAttachments.length === 0) {
        clearAttachmentError();
      }
      return;
    }

    if (
      areExternalAttachmentsEqual(
        externalAttachments,
        lastSyncedExternalAttachments,
      )
    ) {
      return;
    }

    lastSyncedExternalAttachments = externalAttachments;

    if (
      !areLocalAndExternalAttachmentsEqual(attachments, externalAttachments)
    ) {
      setAttachments(toLocalAttachments(externalAttachments), false);
    }

    if (externalAttachments.length === 0) {
      clearAttachmentError();
    }
  });

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
    disabled && "opacity-60 cursor-not-allowed",
  )}
>
  <!-- Slash command autocomplete dropdown -->
  {#if matchingCommands.length > 0}
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
          onmouseenter={() => (selectedCommandIndex = index)}
          onclick={() => selectCommand(cmd)}
        >
          <span class="text-sm font-medium text-primary">/{cmd.name}</span>
          <span class="text-sm text-muted-foreground">{cmd.description}</span>
        </button>
      {/each}
    </div>
  {:else if isSlashCommand && isFocused && parsedCommand && !parsedCommand.args && matchingCommands.length === 0 && !internalValue.endsWith(" ")}
    <!-- No matches indicator -->
    <div
      class="absolute bottom-full left-0 mb-1 px-2 py-1 bg-background border border-border rounded-md"
    >
      <span class="text-xs text-warning">/{parsedCommand.command}</span>
      <span class="text-xs text-muted-foreground ml-2">Unknown command</span>
    </div>
  {/if}

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
      "flex flex-col w-full bg-foreground/3 border border-input-border rounded-md transition-all duration-100 overflow-hidden relative",
      isFocused && "bg-foreground/4 border-ring",
      isDragOver && "border-primary bg-primary/5",
      isSlashCommand &&
        isKnownCommand &&
        commandHandler === "local" &&
        "border-success/50",
      isSlashCommand &&
        isKnownCommand &&
        commandHandler === "unimplemented" &&
        "border-warning/50",
      isSlashCommand && !isKnownCommand && "border-destructive/50",
      isLoading && "bg-primary/5 border-primary/30",
    )}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
    role="group"
  >
    {#if isDragOver}
      <div
        class="absolute inset-0 z-10 pointer-events-none flex items-center justify-center bg-background/60 backdrop-blur-[1px]"
      >
        <span
          class="px-3 py-1 rounded border border-primary/40 bg-primary/10 text-xs text-primary"
        >
          Drop images to attach
        </span>
      </div>
    {/if}

    {#if attachments.length > 0}
      <div
        class="px-3 pt-3 pb-1 flex flex-wrap gap-2 border-b border-border/60"
      >
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
              class="absolute top-0 right-0 w-5 h-5 text-[10px] bg-black/65 text-white hover:bg-black/80"
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
      <textarea
        bind:this={textareaRef}
        bind:value={internalValue}
        {placeholder}
        {disabled}
        class={cn(
          "w-full min-h-11 max-h-[40vh] py-2.5 px-4 pr-32 bg-transparent border-none outline-none resize-none text-foreground overflow-y-auto text-base leading-6",
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
              ? "bg-transparent border-border text-muted-foreground hover:bg-secondary hover:border-foreground hover:text-foreground cursor-pointer"
              : "bg-transparent border-border/70 text-muted-foreground/50 cursor-not-allowed opacity-50",
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
              ? "bg-transparent border-border text-muted-foreground hover:bg-secondary hover:border-foreground hover:text-foreground cursor-pointer"
              : "bg-transparent border-border/70 text-muted-foreground/50 cursor-not-allowed opacity-50",
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
              ? "bg-destructive border-destructive text-destructive-foreground hover:bg-destructive/90"
              : "bg-transparent border border-border text-muted-foreground hover:not-disabled:bg-secondary hover:not-disabled:border-foreground hover:not-disabled:text-foreground",
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
            <!-- Stop square icon -->
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
        {#if isSlashCommand}
          {#if isKnownCommand}
            {#if commandHandler === "local"}
              <span class="text-success font-medium"
                >/{parsedCommand?.command}</span
              >
              <span class="text-muted-foreground ml-1">
                {ALL_SLASH_COMMANDS.find(
                  (c) => c.name === parsedCommand?.command,
                )?.description}
              </span>
            {:else if commandHandler === "unimplemented"}
              <span class="text-warning font-medium"
                >/{parsedCommand?.command}</span
              >
              <span class="text-muted-foreground ml-1">
                Not yet implemented • {ALL_SLASH_COMMANDS.find(
                  (c) => c.name === parsedCommand?.command,
                )?.description}
              </span>
            {:else}
              <span class="text-primary font-medium"
                >/{parsedCommand?.command}</span
              >
              <span class="text-muted-foreground ml-1">
                {ALL_SLASH_COMMANDS.find(
                  (c) => c.name === parsedCommand?.command,
                )?.description}
              </span>
            {/if}
          {:else}
            <span class="text-destructive">/{parsedCommand?.command}</span>
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
