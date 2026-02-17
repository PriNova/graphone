import type { AgentSession } from "@mariozechner/pi-coding-agent";

export interface HostedSession {
  sessionId: string;
  cwd: string;
  createdAt: number;
  session: AgentSession;
  unsubscribe: () => void;
}
