<script lang="ts">
  import { cn } from "$lib/utils/cn";
  import type { UserContentBlock } from "$lib/types/agent";

  interface Props {
    content: UserContentBlock[];
    timestamp?: Date;
  }

  let { content, timestamp }: Props = $props();

  const textContent = $derived(
    content
      .filter(
        (block): block is Extract<UserContentBlock, { type: "text" }> =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join(""),
  );

  const images = $derived(
    content.filter(
      (block): block is Extract<UserContentBlock, { type: "image" }> =>
        block.type === "image",
    ),
  );
</script>

<div class={cn("flex w-full animate-fade-in justify-end")}>
  <div
    class={cn(
      "w-full bg-primary border border-primary text-primary-foreground rounded-lg px-5 py-2 wrap-break-word",
    )}
  >
    {#if textContent.length > 0}
      <pre
        class="text-[0.9375rem] leading-tight whitespace-pre-wrap wrap-break-word font-inherit m-0">{textContent}</pre>
    {/if}

    {#if images.length > 0}
      <div class={cn("flex flex-wrap gap-2", textContent.length > 0 && "mt-2")}>
        {#each images as image, index (`${image.mimeType}-${index}`)}
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt="Attachment"
            class="max-h-40 rounded border border-primary-foreground/20"
            loading="lazy"
            decoding="async"
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
