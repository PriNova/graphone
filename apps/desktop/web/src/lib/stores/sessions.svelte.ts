import { invoke } from "@tauri-apps/api/core";

export interface SessionModelRef {
  provider: string;
  id: string;
}

export interface SessionDescriptor {
  sessionId: string;
  projectDir: string;
  title: string;
  createdAt?: number;
  busy?: boolean;
  model?: SessionModelRef;
  sessionFile?: string;
}

interface RpcResponse<TData = unknown> {
  success: boolean;
  data?: TData;
  error?: string;
}

interface CreateSessionData {
  sessionId: string;
  cwd: string;
  modelFallbackMessage?: string;
  sessionFile?: string;
}

interface ListSessionsData {
  sessions: Array<{
    sessionId?: unknown;
    cwd?: unknown;
    createdAt?: unknown;
    busy?: unknown;
    model?: { provider?: unknown; id?: unknown } | null;
    sessionFile?: unknown;
  }>;
}

function toTitleFromProjectDir(projectDir: string): string {
  const trimmed = projectDir.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  if (parts.length === 0) return projectDir;
  return parts[parts.length - 1] ?? projectDir;
}

export class SessionsStore {
  sessions = $state<SessionDescriptor[]>([]);
  activeSessionId = $state<string | null>(null);
  creating = $state(false);
  error = $state<string | null>(null);

  setActiveSession(sessionId: string): void {
    if (!this.sessions.some((s) => s.sessionId === sessionId)) {
      return;
    }
    this.activeSessionId = sessionId;
  }

  get activeSession(): SessionDescriptor | null {
    if (!this.activeSessionId) {
      return null;
    }
    return this.sessions.find((s) => s.sessionId === this.activeSessionId) ?? null;
  }

  async createSession(
    projectDir: string,
    provider?: string,
    model?: string,
    sessionFile?: string,
  ): Promise<SessionDescriptor> {
    this.creating = true;
    this.error = null;

    try {
      const response = await invoke<RpcResponse<CreateSessionData>>("create_agent", {
        projectDir,
        provider,
        model,
        sessionFile,
      });

      if (!(response && typeof response === "object" && response.success && response.data)) {
        const error = response && typeof response === "object" ? response.error : "Failed to create session";
        throw new Error(error || "Failed to create session");
      }

      const sessionId = response.data.sessionId;
      const cwd = response.data.cwd;

      if (!sessionId || !cwd) {
        throw new Error("Malformed create_agent response");
      }

      const resolvedSessionFile =
        typeof response.data.sessionFile === "string" && response.data.sessionFile.trim().length > 0
          ? response.data.sessionFile.trim()
          : undefined;

      const descriptor: SessionDescriptor = {
        sessionId,
        projectDir: cwd,
        title: toTitleFromProjectDir(cwd),
        sessionFile: resolvedSessionFile,
      };

      this.sessions = [...this.sessions, descriptor];
      this.activeSessionId = descriptor.sessionId;

      return descriptor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.error = message;
      throw error;
    } finally {
      this.creating = false;
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const response = await invoke<RpcResponse>("close_agent", { sessionId });
    if (!(response && typeof response === "object" && response.success)) {
      const error = response && typeof response === "object" ? response.error : "Failed to close session";
      throw new Error(error || "Failed to close session");
    }

    const nextSessions = this.sessions.filter((session) => session.sessionId !== sessionId);
    this.sessions = nextSessions;

    if (this.activeSessionId === sessionId) {
      this.activeSessionId = nextSessions.length > 0 ? nextSessions[0]?.sessionId ?? null : null;
    }
  }

  async refreshFromBackend(): Promise<void> {
    const response = await invoke<RpcResponse<ListSessionsData>>("list_agents");

    if (!(response && typeof response === "object" && response.success && response.data)) {
      return;
    }

    const sessions = Array.isArray(response.data.sessions) ? response.data.sessions : [];
    this.sessions = sessions
      .map((session): SessionDescriptor | null => {
        const sessionId = typeof session.sessionId === "string" ? session.sessionId : null;
        const cwd = typeof session.cwd === "string" ? session.cwd : null;
        if (!sessionId || !cwd) {
          return null;
        }

        const modelProvider = session.model && typeof session.model.provider === "string" ? session.model.provider : null;
        const modelId = session.model && typeof session.model.id === "string" ? session.model.id : null;
        const sessionFile = typeof session.sessionFile === "string" ? session.sessionFile.trim() : "";

        return {
          sessionId,
          projectDir: cwd,
          title: toTitleFromProjectDir(cwd),
          createdAt: typeof session.createdAt === "number" ? session.createdAt : undefined,
          busy: typeof session.busy === "boolean" ? session.busy : undefined,
          model: modelProvider && modelId ? { provider: modelProvider, id: modelId } : undefined,
          sessionFile: sessionFile.length > 0 ? sessionFile : undefined,
        } satisfies SessionDescriptor;
      })
      .filter((value): value is SessionDescriptor => value !== null);

    if (this.activeSessionId && this.sessions.some((s) => s.sessionId === this.activeSessionId)) {
      return;
    }

    this.activeSessionId = this.sessions[0]?.sessionId ?? null;
  }
}

export const sessionsStore = new SessionsStore();
