import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { AgentEvent } from "$lib/types/agent";
import type { SessionRuntime } from "$lib/types/session";

export interface AgentEventBridgeDependencies {
  getRuntime: (sessionId: string) => SessionRuntime | undefined;
  getActiveSessionId: () => string | null;
  handleRuntimeEvent: (runtime: SessionRuntime, event: AgentEvent) => void;
  markSessionSidebarSyncPending: (sessionId: string) => void;
  isSessionSidebarSyncPending: (sessionId: string) => boolean;
  scheduleSessionSidebarRefresh: (delayMs?: number) => void;
  scheduleScrollToBottom: () => void;
  handleAgentError: (errorPayload: string) => void;
  handleAgentTerminated: (exitCode: number | null) => void;
}

export async function setupAgentEventBridge(
  dependencies: AgentEventBridgeDependencies,
): Promise<() => void> {
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;

  unlistenEvent = await listen<
    string | { sessionId?: string; event?: AgentEvent }
  >("agent-event", (event) => {
    try {
      const payload =
        typeof event.payload === "string"
          ? (JSON.parse(event.payload) as unknown)
          : event.payload;

      if (!payload || typeof payload !== "object") {
        return;
      }

      const wrapped = payload as {
        sessionId?: unknown;
        event?: unknown;
        type?: unknown;
      };

      if (
        typeof wrapped.sessionId === "string" &&
        wrapped.event &&
        typeof wrapped.event === "object"
      ) {
        const runtime = dependencies.getRuntime(wrapped.sessionId);
        if (!runtime) {
          return;
        }

        const agentEvent = wrapped.event as AgentEvent;
        const userMessageCountBeforeEvent = runtime.messages.messages.filter(
          (message) => message.type === "user",
        ).length;

        dependencies.handleRuntimeEvent(runtime, agentEvent);

        const isFirstUserMessageStart =
          agentEvent.type === "message_start" &&
          agentEvent.message.role === "user" &&
          userMessageCountBeforeEvent === 0;

        const isFirstUserMessageEnd =
          agentEvent.type === "message_end" &&
          agentEvent.message.role === "user" &&
          userMessageCountBeforeEvent <= 1;

        if (isFirstUserMessageStart || isFirstUserMessageEnd) {
          dependencies.markSessionSidebarSyncPending(wrapped.sessionId);
          dependencies.scheduleSessionSidebarRefresh(240);
        } else if (
          dependencies.isSessionSidebarSyncPending(wrapped.sessionId) &&
          ((agentEvent.type === "message_end" &&
            agentEvent.message.role === "assistant") ||
            agentEvent.type === "turn_end" ||
            agentEvent.type === "agent_end")
        ) {
          // Session files are flushed once assistant output is persisted.
          // Run a follow-up refresh at turn/agent completion for reliability.
          dependencies.scheduleSessionSidebarRefresh(280);
        }

        if (dependencies.getActiveSessionId() === wrapped.sessionId) {
          dependencies.scheduleScrollToBottom();
        }
      }
    } catch (error) {
      console.error("Failed to parse agent event:", error, event.payload);
    }
  });

  unlistenError = await listen<string>("agent-error", (event) => {
    dependencies.handleAgentError(event.payload);
  });

  unlistenTerminated = await listen<number | null>(
    "agent-terminated",
    (event) => {
      dependencies.handleAgentTerminated(event.payload);
    },
  );

  return () => {
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();
  };
}
