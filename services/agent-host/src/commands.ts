import type { HostRuntime } from "./host-runtime.js";
import { failure, success, type HostCommand, type HostResponse } from "./protocol.js";

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireSessionId(command: HostCommand): string {
  return requireNonEmptyString(command.sessionId, "sessionId");
}

export async function handleHostCommand(runtime: HostRuntime, command: HostCommand): Promise<HostResponse> {
  const requestId = typeof command.id === "string" ? command.id : undefined;

  try {
    switch (command.type) {
      case "create_session": {
        const cwd = requireNonEmptyString(command.cwd, "cwd");
        const provider = typeof command.provider === "string" ? command.provider : undefined;
        const modelId = typeof command.modelId === "string" ? command.modelId : undefined;
        const data = await runtime.createSession({
          sessionId: command.sessionId,
          cwd,
          provider,
          modelId,
        });

        return success(requestId, "create_session", data);
      }

      case "close_session": {
        const sessionId = requireSessionId(command);
        await runtime.closeSession(sessionId);
        return success(requestId, "close_session", { sessionId });
      }

      case "list_sessions": {
        return success(requestId, "list_sessions", {
          sessions: runtime.listSessions(),
        });
      }

      case "prompt": {
        const sessionId = requireSessionId(command);
        const message = requireNonEmptyString(command.message, "message");
        const streamingBehavior =
          command.streamingBehavior === "steer" || command.streamingBehavior === "followUp"
            ? command.streamingBehavior
            : undefined;

        await runtime.prompt(sessionId, message, streamingBehavior);
        return success(requestId, "prompt");
      }

      case "steer": {
        const sessionId = requireSessionId(command);
        const message = requireNonEmptyString(command.message, "message");
        await runtime.steer(sessionId, message);
        return success(requestId, "steer");
      }

      case "follow_up": {
        const sessionId = requireSessionId(command);
        const message = requireNonEmptyString(command.message, "message");
        await runtime.followUp(sessionId, message);
        return success(requestId, "follow_up");
      }

      case "abort": {
        const sessionId = requireSessionId(command);
        await runtime.abort(sessionId);
        return success(requestId, "abort");
      }

      case "new_session": {
        const sessionId = requireSessionId(command);
        return success(requestId, "new_session", await runtime.newSession(sessionId));
      }

      case "get_messages": {
        const sessionId = requireSessionId(command);
        return success(requestId, "get_messages", runtime.getMessages(sessionId));
      }

      case "get_state": {
        const sessionId = requireSessionId(command);
        return success(requestId, "get_state", runtime.getState(sessionId));
      }

      case "set_model": {
        const sessionId = requireSessionId(command);
        const provider = requireNonEmptyString(command.provider, "provider");
        const modelId = requireNonEmptyString(command.modelId, "modelId");
        return success(requestId, "set_model", await runtime.setModel(sessionId, provider, modelId));
      }

      case "cycle_model": {
        const sessionId = requireSessionId(command);
        return success(requestId, "cycle_model", await runtime.cycleModel(sessionId));
      }

      case "get_available_models": {
        return success(requestId, "get_available_models", await runtime.getAvailableModels());
      }

      case "shutdown": {
        await runtime.shutdown();
        return success(requestId, "shutdown");
      }

      case "ping": {
        return success(requestId, "ping", { ready: true });
      }

      default: {
        const unknownType = (command as { type?: string }).type ?? "unknown";
        return failure(requestId, unknownType, `Unknown command: ${unknownType}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const commandType = (command as { type?: string }).type ?? "unknown";
    return failure(requestId, commandType, message);
  }
}
