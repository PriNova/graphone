<script lang="ts">
  import '$lib/styles/index.css';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    // Mark as desktop app for enhanced styling
    document.documentElement.setAttribute('data-desktop', 'true');
  });
</script>

<div class="flex flex-col min-h-screen w-full">
  {@render children()}
</div>
