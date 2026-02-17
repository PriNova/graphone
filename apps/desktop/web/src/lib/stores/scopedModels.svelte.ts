// Compatibility shim.
//
// Graphone originally shipped a "scopedModels" store that backed the ModelSelector.
// The feature was renamed/reworked to properly reflect pi's `enabledModels` setting.
//
// Some dev builds (or a cached Tauri webview) may still request this module by path.
// Keep this file around to avoid 404s and provide a minimal API-compatible facade.

import { enabledModelsStore } from '$lib/stores/enabledModels.svelte';

class ScopedModelsCompatStore {
  // Old API used `count` and treated "no scope" as 0.
  get count(): number {
    return enabledModelsStore.patterns.length;
  }

  // Old API: true if the concrete fullId is explicitly listed.
  // (Does not attempt to expand glob/partial patterns.)
  isScoped(provider: string, modelId: string): boolean {
    const fullId = `${provider}/${modelId}`;
    return enabledModelsStore.patterns.includes(fullId);
  }

  // Old API was sync and returned the new state. We do an optimistic toggle and
  // persist asynchronously via enabledModelsStore.
  toggle(provider: string, modelId: string): boolean {
    const fullId = `${provider}/${modelId}`;
    const has = enabledModelsStore.patterns.includes(fullId);
    void enabledModelsStore.toggleModel(provider, modelId).catch(() => undefined);
    return !has;
  }
}

export const scopedModelsStore = new ScopedModelsCompatStore();
