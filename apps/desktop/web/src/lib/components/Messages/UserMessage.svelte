<script lang="ts">
  import { cn } from "$lib/utils/cn";
  import type { UserContentBlock } from "$lib/types/agent";
  import {
    normalizeSkillUserMessage,
    parseSkillBlock,
  } from "$lib/utils/skill-block";

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

  const parsedSkillBlock = $derived(
    images.length === 0 ? parseSkillBlock(textContent) : null,
  );

  const skillUserMessage = $derived(
    normalizeSkillUserMessage(parsedSkillBlock?.userMessage),
  );
</script>

<div class={cn("flex w-full animate-fade-in justify-end")}>
  <div
    class={cn(
      "w-full bg-primary border border-primary text-primary-foreground rounded-lg px-5 py-2 wrap-break-word",
    )}
  >
    {#if parsedSkillBlock}
      <div
        class="rounded-md border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-2"
      >
        <div
          class="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] opacity-75"
        >
          Skill
        </div>
        <div class="mt-1 text-[0.95rem] font-medium leading-tight">
          {parsedSkillBlock.name}
        </div>
      </div>

      {#if skillUserMessage.length > 0}
        <pre
          class="text-[0.9375rem] leading-tight whitespace-pre-wrap wrap-break-word font-inherit m-0 mt-2">{skillUserMessage}</pre>
      {/if}
    {:else if textContent.length > 0}
      <pre
        class="text-[0.9375rem] leading-tight whitespace-pre-wrap wrap-break-word font-inherit m-0">{textContent}</pre>
    {/if}

    {#if images.length > 0}
      <div
        class={cn(
          "flex flex-wrap gap-2",
          (parsedSkillBlock || textContent.length > 0) && "mt-2",
        )}
      >
        {#each images as image, index (`${image.mimeType}-${index}`)}
          <img
            src={`data:${image.mimeType};base64,${image.data}`}
            alt="Attachment"
            class="max-h-40 rounded border border-border"
            loading="lazy"
            decoding="async"
          />
        {/each}
      </div>
    {/if}
  </div>
</div>
