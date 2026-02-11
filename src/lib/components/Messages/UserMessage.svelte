<script lang="ts">
  import { cn } from '$lib/utils/cn';
  
  interface Props {
    content: string;
    timestamp?: Date;
  }

  let { content, timestamp }: Props = $props();
</script>

<div class={cn(
  "flex w-full animate-fade-in justify-end"
)}>
  <div class={cn(
    "w-full bg-primary border border-primary text-primary-foreground rounded-lg px-5 py-4 break-words"
  )}>
    <pre class="text-[0.9375rem] leading-relaxed whitespace-pre-wrap break-words font-inherit m-0">{content}</pre>
  </div>
</div>
