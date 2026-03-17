<script lang="ts">
  import { cn } from "$lib/utils/cn";

  type BangPrefixMode = "include" | "exclude";

  interface Props {
    mode: BangPrefixMode;
    isValid: boolean;
  }

  let { mode, isValid }: Props = $props();

  const label = $derived(
    mode === "include"
      ? "Bash • included in context"
      : "Bash • excluded from context",
  );
</script>

<div class="px-3 pt-2 pb-0.5">
  <span
    class={cn(
      "inline-flex max-w-[calc(100%-7rem)] items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors",
      mode === "include"
        ? "border-success/30 bg-success/8 text-success"
        : "border-border bg-surface-active text-muted-foreground",
      !isValid && "opacity-80",
    )}
  >
    {#if mode === "include"}
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
          d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
        />
        <circle cx="12" cy="12" r="3" stroke-width="2" />
      </svg>
    {:else}
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
          d="M3 3l18 18"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M10.58 10.58a2 2 0 002.83 2.83"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9.88 4.24A10.94 10.94 0 0112 4c5 0 9.27 3.11 11 7.5a11.8 11.8 0 01-4.04 5.19"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M6.61 6.61A10.93 10.93 0 001 11.5C2.73 15.89 7 19 12 19a10.94 10.94 0 004.24-.85"
        />
      </svg>
    {/if}
    <span class="truncate">{label}</span>
  </span>
</div>
