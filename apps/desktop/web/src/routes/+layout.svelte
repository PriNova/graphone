<script lang="ts">
  import "$lib/styles/index.css";
  import { onMount } from "svelte";

  import { settingsStore } from "$lib/stores/settings.svelte";
  import {
    applyUiThemeEverywhere,
    listenForUiThemeChanges,
  } from "$lib/theme/app-theme";

  let { children } = $props();

  $effect(() => {
    if (typeof document === "undefined") {
      return;
    }

    void applyUiThemeEverywhere(settingsStore.theme);
  });

  onMount(() => {
    // Mark as desktop app for enhanced styling
    document.documentElement.setAttribute("data-desktop", "true");

    let unlistenThemeChanges: (() => void) | null = null;

    void listenForUiThemeChanges((theme) => {
      if (theme === settingsStore.theme) {
        return;
      }

      settingsStore.setThemeState(theme);
    }).then((cleanup) => {
      unlistenThemeChanges = cleanup;
    });

    return () => {
      unlistenThemeChanges?.();
    };
  });
</script>

<div class="flex flex-col min-h-screen w-full">
  {@render children()}
</div>
