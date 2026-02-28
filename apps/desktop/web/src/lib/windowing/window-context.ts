export type WindowRole = "main" | "compact-session";

export interface WindowContext {
  role: WindowRole;
  sessionId: string | null;
  projectDir: string | null;
  sessionFile: string | null;
}

export const WINDOW_ROLE_QUERY_KEY = "windowRole";
export const SESSION_ID_QUERY_KEY = "sessionId";
export const PROJECT_DIR_QUERY_KEY = "projectDir";
export const SESSION_FILE_QUERY_KEY = "sessionFile";

function normalizeQueryValue(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseWindowContextFromSearch(search: string): WindowContext {
  const params = new URLSearchParams(search);

  const roleParam = normalizeQueryValue(params.get(WINDOW_ROLE_QUERY_KEY));
  const sessionId = normalizeQueryValue(params.get(SESSION_ID_QUERY_KEY));
  const projectDir = normalizeQueryValue(params.get(PROJECT_DIR_QUERY_KEY));
  const sessionFile = normalizeQueryValue(params.get(SESSION_FILE_QUERY_KEY));

  const isCompactSessionRole = roleParam === "compact-session";

  if (!isCompactSessionRole || !sessionId) {
    return {
      role: "main",
      sessionId: null,
      projectDir: null,
      sessionFile: null,
    };
  }

  return {
    role: "compact-session",
    sessionId,
    projectDir,
    sessionFile,
  };
}

export function getCurrentWindowContext(): WindowContext {
  if (typeof window === "undefined") {
    return {
      role: "main",
      sessionId: null,
      projectDir: null,
      sessionFile: null,
    };
  }

  return parseWindowContextFromSearch(window.location.search);
}
