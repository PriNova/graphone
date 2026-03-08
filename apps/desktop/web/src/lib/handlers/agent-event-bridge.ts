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

interface ChunkedAgentEventPayload {
  type: "agent_event_chunk";
  chunkId: string;
  chunkIndex: number;
  chunkCount: number;
  payloadChunk: string;
}

interface PendingChunkedAgentEvent {
  createdAt: number;
  chunkCount: number;
  chunks: Array<string | undefined>;
}

const MAX_PENDING_CHUNK_AGE_MS = 60_000;
const pendingChunkedAgentEvents = new Map<string, PendingChunkedAgentEvent>();

function isChunkedAgentEventPayload(
  payload: unknown,
): payload is ChunkedAgentEventPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const typed = payload as {
    type?: unknown;
    chunkId?: unknown;
    chunkIndex?: unknown;
    chunkCount?: unknown;
    payloadChunk?: unknown;
  };

  return (
    typed.type === "agent_event_chunk" &&
    typeof typed.chunkId === "string" &&
    typeof typed.chunkIndex === "number" &&
    Number.isInteger(typed.chunkIndex) &&
    typed.chunkIndex >= 0 &&
    typeof typed.chunkCount === "number" &&
    Number.isInteger(typed.chunkCount) &&
    typed.chunkCount > 0 &&
    typeof typed.payloadChunk === "string"
  );
}

function pruneExpiredChunkedAgentEvents(now = Date.now()): void {
  for (const [chunkId, pending] of pendingChunkedAgentEvents.entries()) {
    if (now - pending.createdAt > MAX_PENDING_CHUNK_AGE_MS) {
      pendingChunkedAgentEvents.delete(chunkId);
    }
  }
}

function acceptChunkedAgentPayload(
  payload: ChunkedAgentEventPayload,
): unknown | null {
  pruneExpiredChunkedAgentEvents();

  if (payload.chunkIndex >= payload.chunkCount) {
    console.warn("Ignoring invalid chunked agent event payload", payload);
    return null;
  }

  const existing = pendingChunkedAgentEvents.get(payload.chunkId);
  const pending =
    existing && existing.chunkCount === payload.chunkCount
      ? existing
      : {
          createdAt: Date.now(),
          chunkCount: payload.chunkCount,
          chunks: Array<string | undefined>(payload.chunkCount).fill(undefined),
        };

  pending.chunks[payload.chunkIndex] = payload.payloadChunk;
  pendingChunkedAgentEvents.set(payload.chunkId, pending);

  if (pending.chunks.some((chunk) => chunk === undefined)) {
    return null;
  }

  pendingChunkedAgentEvents.delete(payload.chunkId);

  try {
    return JSON.parse(pending.chunks.join("")) as unknown;
  } catch (error) {
    console.error(
      "Failed to parse reassembled chunked agent event:",
      error,
      payload,
    );
    return null;
  }
}

export async function setupAgentEventBridge(
  dependencies: AgentEventBridgeDependencies,
): Promise<() => void> {
  let unlistenEvent: UnlistenFn | null = null;
  let unlistenError: UnlistenFn | null = null;
  let unlistenTerminated: UnlistenFn | null = null;

  const routePayload = (payload: unknown): void => {
    if (!payload || typeof payload !== "object") {
      return;
    }

    if (isChunkedAgentEventPayload(payload)) {
      const reassembledPayload = acceptChunkedAgentPayload(payload);
      if (reassembledPayload !== null) {
        routePayload(reassembledPayload);
      }
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
  };

  unlistenEvent = await listen<
    string | { sessionId?: string; event?: AgentEvent }
  >("agent-event", (event) => {
    try {
      const payload =
        typeof event.payload === "string"
          ? (JSON.parse(event.payload) as unknown)
          : event.payload;

      routePayload(payload);
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
    pendingChunkedAgentEvents.clear();
    unlistenEvent?.();
    unlistenError?.();
    unlistenTerminated?.();
  };
}
