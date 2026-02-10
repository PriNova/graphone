<script lang="ts">
  import '$lib/styles/variables.css';
  import { onMount } from 'svelte';

  let { children } = $props();

  onMount(() => {
    // Mark as desktop app for enhanced styling
    document.documentElement.setAttribute('data-desktop', 'true');
  });
</script>

<div class="app-container">
  {@render children()}
</div>

<style>
  :global(*) {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :global(html, body) {
    height: 100%;
    width: 100%;
  }

  :global(body) {
    font-family: var(--font-family);
    font-size: var(--font-size-base);
    line-height: var(--line-height-base);
    background: var(--background);
    color: var(--foreground);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .app-container {
    min-height: 100vh;
    width: 100%;
    display: flex;
    flex-direction: column;
  }
</style>
