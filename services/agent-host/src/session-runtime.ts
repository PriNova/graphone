import type { AgentSession } from "@earendil-works/pi-coding-agent";

export interface HostedSession {
  sessionId: string;
  cwd: string;
  createdAt: number;
  session: AgentSession;
  unsubscribe: () => void;
}
