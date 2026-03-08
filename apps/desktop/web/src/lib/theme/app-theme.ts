import { setTheme as setAppTheme } from "@tauri-apps/api/app";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

export type UiTheme = "light" | "dark";

export const UI_THEME_STORAGE_KEY = "graphone.ui.theme";
export const UI_THEME_CHANGED_EVENT = "graphone://ui-theme-changed";

export function isUiTheme(value: unknown): value is UiTheme {
  return value === "light" || value === "dark";
}

function getStoredUiTheme(): UiTheme | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const stored = window.localStorage.getItem(UI_THEME_STORAGE_KEY);
    return isUiTheme(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function getBootstrappedUiTheme(): UiTheme {
  if (typeof document !== "undefined") {
    const attrTheme = document.documentElement.getAttribute("data-theme");
    if (isUiTheme(attrTheme)) {
      return attrTheme;
    }

    if (document.documentElement.classList.contains("dark")) {
      return "dark";
    }
  }

  return getStoredUiTheme() ?? "dark";
}

export function applyUiTheme(theme: UiTheme): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(UI_THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore localStorage failures (privacy mode, sandboxed environments, etc.)
    }
  }
}

export async function syncNativeTheme(theme: UiTheme): Promise<void> {
  try {
    await setAppTheme(theme);
  } catch {
    // Browser mode / unavailable Tauri runtime - ignore.
  }
}

export async function applyUiThemeEverywhere(theme: UiTheme): Promise<void> {
  applyUiTheme(theme);
  await syncNativeTheme(theme);
}

export async function broadcastUiTheme(theme: UiTheme): Promise<void> {
  try {
    await emit(UI_THEME_CHANGED_EVENT, theme);
  } catch {
    // Ignore if the Tauri event bridge is unavailable.
  }
}

export async function listenForUiThemeChanges(
  handler: (theme: UiTheme) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<UiTheme>(UI_THEME_CHANGED_EVENT, (event) => {
      if (!isUiTheme(event.payload)) {
        return;
      }

      handler(event.payload);
    });
  } catch {
    return () => undefined;
  }
}
