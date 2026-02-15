import { browser } from '$app/environment';
import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEY = 'graphone-scoped-models';

/**
 * Scoped models store - tracks which models the user has marked as "active"
 * for quick access in the model selector.
 * 
 * Persists to localStorage so selections survive app restarts.
 * Also loads initial models from pi settings.json enabledModels.
 */
class ScopedModelsStore {
  /** Set of model keys in format "provider/modelId" */
  scopedModelKeys = $state<Set<string>>(new Set());

  /** Whether the store has been initialized from localStorage */
  initialized = $state(false);

  constructor() {
    if (browser) {
      this.loadFromStorage();
    }
  }

  private async loadFromStorage(): Promise<void> {
    // First, try to load from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          this.scopedModelKeys = new Set(parsed);
        }
      }
    } catch (error) {
      console.warn('Failed to load scoped models from storage:', error);
    }

    // If no localStorage models, try to load from pi settings
    if (this.scopedModelKeys.size === 0) {
      await this.loadFromSettings();
    }

    this.initialized = true;
  }

  private async loadFromSettings(): Promise<void> {
    try {
      const enabledModels = await invoke<string[]>('get_enabled_models');
      if (enabledModels && enabledModels.length > 0) {
        console.log(`Loading ${enabledModels.length} enabled models from pi settings`);
        // Convert "provider/modelId" strings to Set
        this.scopedModelKeys = new Set(enabledModels);
        // Save to localStorage for future use
        this.saveToStorage();
      }
    } catch (error) {
      console.warn('Failed to load enabled models from settings:', error);
    }
  }

  private saveToStorage(): void {
    if (!browser) return;
    try {
      const arr = [...this.scopedModelKeys];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (error) {
      console.warn('Failed to save scoped models to storage:', error);
    }
  }

  /**
   * Create a model key from provider and model ID
   */
  private makeKey(provider: string, modelId: string): string {
    return `${provider}/${modelId}`;
  }

  /**
   * Check if a model is in the scoped set
   */
  isScoped(provider: string, modelId: string): boolean {
    return this.scopedModelKeys.has(this.makeKey(provider, modelId));
  }

  /**
   * Toggle a model's scoped status
   */
  toggle(provider: string, modelId: string): boolean {
    const key = this.makeKey(provider, modelId);
    const newSet = new Set(this.scopedModelKeys);
    
    if (newSet.has(key)) {
      newSet.delete(key);
    } else {
      newSet.add(key);
    }
    
    this.scopedModelKeys = newSet;
    this.saveToStorage();
    
    return newSet.has(key);
  }

  /**
   * Add a model to the scoped set
   */
  add(provider: string, modelId: string): void {
    const key = this.makeKey(provider, modelId);
    if (!this.scopedModelKeys.has(key)) {
      const newSet = new Set(this.scopedModelKeys);
      newSet.add(key);
      this.scopedModelKeys = newSet;
      this.saveToStorage();
    }
  }

  /**
   * Remove a model from the scoped set
   */
  remove(provider: string, modelId: string): void {
    const key = this.makeKey(provider, modelId);
    if (this.scopedModelKeys.has(key)) {
      const newSet = new Set(this.scopedModelKeys);
      newSet.delete(key);
      this.scopedModelKeys = newSet;
      this.saveToStorage();
    }
  }

  /**
   * Get all scoped model keys as an array
   */
  getAll(): string[] {
    return [...this.scopedModelKeys];
  }

  /**
   * Clear all scoped models
   */
  clear(): void {
    this.scopedModelKeys = new Set();
    this.saveToStorage();
  }

  /**
   * Get count of scoped models
   */
  get count(): number {
    return this.scopedModelKeys.size;
  }
}

export const scopedModelsStore = new ScopedModelsStore();
