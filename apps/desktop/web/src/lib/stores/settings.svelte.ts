import { LazyStore } from "@tauri-apps/plugin-store";

/**
 * UI settings that persist across app restarts.
 */
export interface UiSettings {
  /** Project scope paths that are collapsed in the sidebar */
  collapsedScopes: string[];
  /** The last selected project scope path */
  lastSelectedScope: string;
  /** Which models to show: "all" or only "enabled" */
  modelFilter: "all" | "enabled";
}

const DEFAULT_SETTINGS: UiSettings = {
  collapsedScopes: [],
  lastSelectedScope: "",
  modelFilter: "enabled",
};

const STORE_FILE = "settings.json";

/**
 * Persistent settings store using tauri-plugin-store.
 *
 * Uses LazyStore for deferred loading - the store file is only loaded
 * on first access, improving startup performance.
 *
 * Settings are saved explicitly after each change.
 */
export class SettingsStore {
  private store = new LazyStore(STORE_FILE, {
    defaults: {},
    autoSave: 100, // Auto-save with 100ms debounce
  });

  collapsedScopes = $state<string[]>([]);
  lastSelectedScope = $state<string>("");
  modelFilter = $state<"all" | "enabled">("enabled");

  /** Whether settings have been loaded from disk */
  loaded = $state(false);

  /** Any error that occurred during loading/saving */
  error = $state<string | null>(null);

  /**
   * Load settings from disk. Should be called once on app mount.
   * If the store file doesn't exist, default values are used.
   */
  async load(): Promise<void> {
    try {
      // Ensure store is initialized
      await this.store.init();

      const [collapsedScopes, lastSelectedScope, modelFilter] =
        await Promise.all([
          this.store.get<string[]>("ui.collapsedScopes"),
          this.store.get<string>("ui.lastSelectedScope"),
          this.store.get<"all" | "enabled">("ui.modelFilter"),
        ]);

      this.collapsedScopes = Array.isArray(collapsedScopes)
        ? collapsedScopes.filter((s) => typeof s === "string")
        : DEFAULT_SETTINGS.collapsedScopes;

      this.lastSelectedScope =
        typeof lastSelectedScope === "string"
          ? lastSelectedScope
          : DEFAULT_SETTINGS.lastSelectedScope;

      this.modelFilter =
        modelFilter === "all" || modelFilter === "enabled"
          ? modelFilter
          : DEFAULT_SETTINGS.modelFilter;

      this.loaded = true;
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.error("Failed to load settings:", err);
    }
  }

  /**
   * Persist all current settings to disk.
   */
  async save(): Promise<void> {
    try {
      await this.store.set("ui.collapsedScopes", this.collapsedScopes);
      await this.store.set("ui.lastSelectedScope", this.lastSelectedScope);
      await this.store.set("ui.modelFilter", this.modelFilter);
      await this.store.save();
      this.error = null;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      console.error("Failed to save settings:", err);
    }
  }

  // --- Collapsed Scopes ---

  isScopeCollapsed(scopePath: string): boolean {
    return this.collapsedScopes.includes(scopePath);
  }

  async toggleScopeCollapsed(scopePath: string): Promise<void> {
    if (this.collapsedScopes.includes(scopePath)) {
      this.collapsedScopes = this.collapsedScopes.filter(
        (s) => s !== scopePath,
      );
    } else {
      this.collapsedScopes = [...this.collapsedScopes, scopePath];
    }
    await this.store.set("ui.collapsedScopes", this.collapsedScopes);
    // autoSave handles persistence via debounce
  }

  async setCollapsedScopes(scopes: string[]): Promise<void> {
    this.collapsedScopes = scopes;
    await this.store.set("ui.collapsedScopes", scopes);
  }

  // --- Last Selected Scope ---

  async setLastSelectedScope(scopePath: string): Promise<void> {
    this.lastSelectedScope = scopePath;
    await this.store.set("ui.lastSelectedScope", scopePath);
  }

  // --- Model Filter ---

  async setModelFilter(filter: "all" | "enabled"): Promise<void> {
    this.modelFilter = filter;
    await this.store.set("ui.modelFilter", filter);
  }

  async toggleModelFilter(): Promise<void> {
    this.modelFilter = this.modelFilter === "all" ? "enabled" : "all";
    await this.store.set("ui.modelFilter", this.modelFilter);
  }

  // --- Reset ---

  /**
   * Reset all settings to defaults.
   */
  async reset(): Promise<void> {
    this.collapsedScopes = DEFAULT_SETTINGS.collapsedScopes;
    this.lastSelectedScope = DEFAULT_SETTINGS.lastSelectedScope;
    this.modelFilter = DEFAULT_SETTINGS.modelFilter;
    await this.store.clear();
    await this.store.save();
  }
}

export const settingsStore = new SettingsStore();
