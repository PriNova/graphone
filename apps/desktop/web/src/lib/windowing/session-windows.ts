import { getAllWindows } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import {
  PROJECT_DIR_QUERY_KEY,
  SESSION_FILE_QUERY_KEY,
  SESSION_ID_QUERY_KEY,
  WINDOW_ROLE_QUERY_KEY,
} from "$lib/windowing/window-context";

const MAIN_WINDOW_LABEL = "main";
const FLOATING_SESSION_WINDOW_PREFIX = "floating-session-";

function sanitizeSessionIdForWindowLabel(sessionId: string): string {
  const sanitized = sessionId
    .trim()
    .replace(/[^a-zA-Z0-9\-/:_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized.length > 0 ? sanitized : "session";
}

export function toFloatingSessionWindowLabel(sessionId: string): string {
  return `${FLOATING_SESSION_WINDOW_PREFIX}${sanitizeSessionIdForWindowLabel(sessionId)}`;
}

async function focusWindowByLabel(label: string): Promise<boolean> {
  const windows = await getAllWindows().catch(() => []);
  const exists = windows.some((window) => window.label === label);
  if (!exists) {
    return false;
  }

  const target = await WebviewWindow.getByLabel(label).catch(() => null);
  if (!target) {
    return false;
  }

  await target.show().catch(() => undefined);
  await target.setFocus().catch(() => undefined);
  return true;
}

function buildFloatingSessionWindowUrl(args: {
  sessionId: string;
  projectDir?: string;
  sessionFile?: string;
}): string {
  const query = new URLSearchParams();
  query.set(WINDOW_ROLE_QUERY_KEY, "floating-session-chat");

  const sessionId = args.sessionId.trim();
  if (sessionId.length > 0) {
    query.set(SESSION_ID_QUERY_KEY, sessionId);
  }

  const projectDir = args.projectDir?.trim();
  if (projectDir && projectDir.length > 0) {
    query.set(PROJECT_DIR_QUERY_KEY, projectDir);
  }

  const sessionFile = args.sessionFile?.trim();
  if (sessionFile && sessionFile.length > 0) {
    query.set(SESSION_FILE_QUERY_KEY, sessionFile);
  }

  return `/?${query.toString()}`;
}

export interface OpenFloatingSessionWindowArgs {
  sessionId: string;
  projectDir?: string;
  sessionFile?: string;
}

export async function openOrFocusFloatingSessionWindow(
  args: OpenFloatingSessionWindowArgs,
): Promise<void> {
  const sessionId = args.sessionId.trim();
  if (sessionId.length === 0) {
    return;
  }

  const label = toFloatingSessionWindowLabel(sessionId);
  const alreadyOpen = await focusWindowByLabel(label);
  if (alreadyOpen) {
    return;
  }

  const windowUrl = buildFloatingSessionWindowUrl({
    sessionId,
    projectDir: args.projectDir,
    sessionFile: args.sessionFile,
  });

  new WebviewWindow(label, {
    title: "Graphone Session",
    url: windowUrl,
    width: 900,
    height: 620,
    minWidth: 660,
    minHeight: 380,
    transparent: false,
    shadow: true,
    decorations: true,
    resizable: true,
    focus: true,
  });
}

export async function listOpenFloatingSessionWindowLabels(): Promise<string[]> {
  const windows = await getAllWindows().catch(() => []);
  return windows
    .map((window) => window.label)
    .filter((label) => label.startsWith(FLOATING_SESSION_WINDOW_PREFIX));
}

export async function openOrFocusMainWindow(): Promise<void> {
  const focused = await focusWindowByLabel(MAIN_WINDOW_LABEL);
  if (focused) {
    return;
  }

  new WebviewWindow(MAIN_WINDOW_LABEL, {
    title: "Graphone",
    url: "/",
    width: 1024,
    height: 768,
    transparent: false,
    shadow: true,
    decorations: true,
    resizable: true,
    focus: true,
  });
}
