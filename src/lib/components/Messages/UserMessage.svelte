<script lang="ts">
  interface Props {
    content: string;
    timestamp?: Date;
  }

  let { content, timestamp }: Props = $props();
</script>

<div class="message user">
  <div class="message-bubble">
    <pre class="message-content">{content}</pre>
  </div>
</div>

<style>
  @import './UserMessage.css';
</style>
