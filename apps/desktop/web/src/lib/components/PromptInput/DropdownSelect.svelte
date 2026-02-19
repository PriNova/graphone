<script lang="ts">
  import { onMount, tick } from "svelte";
  import { cn } from "$lib/utils/cn";

  type DropdownDirection = "up" | "down";
  type DropdownAlign = "left" | "right";

  export interface DropdownOption {
    key: string;
    label: string;
  }

  interface Props {
    options?: DropdownOption[];
    selectedKey?: string;
    triggerLabel?: string;
    disabled?: boolean;
    triggerClass?: string;
    menuClass?: string;
    align?: DropdownAlign;
    minHeight?: number;
    idealMaxHeight?: number;
    emptyText?: string;
    ariaLabel?: string;
    listAriaLabel?: string;
    title?: string;
    onselect?: (key: string) => void | Promise<void>;
  }

  let {
    options = [],
    selectedKey = "",
    triggerLabel = "",
    disabled = false,
    triggerClass = "",
    menuClass = "",
    align = "left",
    minHeight = 120,
    idealMaxHeight = 320,
    emptyText = "No options available",
    ariaLabel = "Select option",
    listAriaLabel = "Available options",
    title,
    onselect,
  }: Props = $props();

  let isOpen = $state(false);
  let dropdownDirection = $state<DropdownDirection>("up");
  let dropdownMaxHeight = $state(240);

  let containerEl = $state<HTMLDivElement | null>(null);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  function updateDropdownPlacement(): void {
    if (!containerEl) return;

    const rect = containerEl.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 8;

    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - margin);
    const spaceAbove = Math.max(0, rect.top - margin);

    if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
      dropdownDirection = "down";
      dropdownMaxHeight = Math.max(
        minHeight,
        Math.min(idealMaxHeight, spaceBelow),
      );
    } else {
      dropdownDirection = "up";
      dropdownMaxHeight = Math.max(
        minHeight,
        Math.min(idealMaxHeight, spaceAbove),
      );
    }
  }

  async function openDropdown(): Promise<void> {
    if (disabled) return;

    isOpen = true;
    await tick();
    updateDropdownPlacement();

    const selectedEl = dropdownEl?.querySelector<HTMLElement>(
      '[data-selected="true"]',
    );
    selectedEl?.scrollIntoView({ block: "nearest" });
  }

  function closeDropdown(): void {
    isOpen = false;
  }

  async function toggleDropdown(): Promise<void> {
    if (isOpen) {
      closeDropdown();
      return;
    }

    await openDropdown();
  }

  async function selectOption(key: string): Promise<void> {
    await onselect?.(key);
    closeDropdown();
  }

  function handleTriggerKeydown(event: KeyboardEvent): void {
    if (
      event.key === "ArrowDown" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      void openDropdown();
    } else if (event.key === "Escape") {
      closeDropdown();
    }
  }

  $effect(() => {
    if (disabled && isOpen) {
      isOpen = false;
    }
  });

  onMount(() => {
    const handlePointerDown = (event: MouseEvent): void => {
      if (!isOpen || !containerEl) return;
      if (!containerEl.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    const handleWindowChange = (): void => {
      if (!isOpen) return;
      updateDropdownPlacement();
    };

    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeDropdown();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
      document.removeEventListener("keydown", handleEscape);
    };
  });
</script>

<div class="relative" bind:this={containerEl}>
  <button
    type="button"
    class={cn(
      "bg-input-background border border-border rounded px-2 py-0.5 text-xs text-foreground",
      "focus:outline-none focus:border-ring",
      "inline-flex items-center justify-between gap-2",
      disabled && "opacity-60 cursor-not-allowed",
      triggerClass,
    )}
    onclick={toggleDropdown}
    onkeydown={handleTriggerKeydown}
    {disabled}
    {title}
    aria-label={ariaLabel}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
  >
    <span class="truncate">{triggerLabel}</span>
    <svg
      class={cn(
        "h-3 w-3 shrink-0 transition-transform",
        isOpen && "rotate-180",
      )}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  </button>

  {#if isOpen}
    <div
      bind:this={dropdownEl}
      class={cn(
        "absolute z-50 bg-input-background text-foreground border border-border rounded-md shadow-lg overflow-y-auto",
        align === "left" ? "left-0" : "right-0",
        dropdownDirection === "down" ? "top-full mt-1" : "bottom-full mb-1",
        menuClass,
      )}
      style={`max-height: ${dropdownMaxHeight}px;`}
      role="listbox"
      aria-label={listAriaLabel}
    >
      {#if options.length === 0}
        <div class="px-2 py-1.5 text-xs text-muted-foreground">{emptyText}</div>
      {:else}
        {#each options as option (option.key)}
          <button
            type="button"
            class={cn(
              "w-full px-2 py-1.5 text-left text-xs text-foreground hover:bg-secondary",
              option.key === selectedKey && "bg-accent",
            )}
            data-selected={option.key === selectedKey}
            onclick={() => selectOption(option.key)}
          >
            {option.label}
          </button>
        {/each}
      {/if}
    </div>
  {/if}
</div>
