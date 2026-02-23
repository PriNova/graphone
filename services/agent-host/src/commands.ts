import type { HostRuntime } from "./host-runtime.js";
import {
  failure,
  success,
  type HostCommand,
  type HostImageAttachment,
  type HostResponse,
} from "./protocol.js";

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function requireSessionId(command: HostCommand): string {
  return requireNonEmptyString(command.sessionId, "sessionId");
}

function parseImageAttachments(
  value: unknown,
): HostImageAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const parsed = value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const source = item as {
        type?: unknown;
        data?: unknown;
        mimeType?: unknown;
      };

      if (
        source.type !== "image" ||
        typeof source.data !== "string" ||
        typeof source.mimeType !== "string"
      ) {
        return null;
      }

      return {
        type: "image" as const,
        data: source.data,
        mimeType: source.mimeType,
      };
    })
    .filter((item): item is HostImageAttachment => item !== null);

  return parsed.length > 0 ? parsed : undefined;
}

export async function handleHostCommand(
  runtime: HostRuntime,
  command: HostCommand,
): Promise<HostResponse> {
  const requestId = typeof command.id === "string" ? command.id : undefined;

  try {
    switch (command.type) {
      case "create_session": {
        const cwd = requireNonEmptyString(command.cwd, "cwd");
        const provider =
          typeof command.provider === "string" ? command.provider : undefined;
        const modelId =
          typeof command.modelId === "string" ? command.modelId : undefined;
        const sessionFile =
          typeof command.sessionFile === "string"
            ? command.sessionFile
            : undefined;
        const data = await runtime.createSession({
          sessionId: command.sessionId,
          cwd,
          provider,
          modelId,
          sessionFile,
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
        const message =
          typeof command.message === "string" ? command.message : "";
        const images = parseImageAttachments(command.images);

        if (message.trim().length === 0 && !images) {
          throw new Error("message must be a non-empty string");
        }

        const streamingBehavior =
          command.streamingBehavior === "steer" ||
          command.streamingBehavior === "followUp"
            ? command.streamingBehavior
            : undefined;

        await runtime.prompt(sessionId, message, images, streamingBehavior);
        return success(requestId, "prompt");
      }

      case "steer": {
        const sessionId = requireSessionId(command);
        const message = requireNonEmptyString(command.message, "message");
        await runtime.steer(
          sessionId,
          message,
          parseImageAttachments(command.images),
        );
        return success(requestId, "steer");
      }

      case "follow_up": {
        const sessionId = requireSessionId(command);
        const message = requireNonEmptyString(command.message, "message");
        await runtime.followUp(
          sessionId,
          message,
          parseImageAttachments(command.images),
        );
        return success(requestId, "follow_up");
      }

      case "abort": {
        const sessionId = requireSessionId(command);
        await runtime.abort(sessionId);
        return success(requestId, "abort");
      }

      case "new_session": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "new_session",
          await runtime.newSession(sessionId),
        );
      }

      case "get_messages": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "get_messages",
          runtime.getMessages(sessionId),
        );
      }

      case "get_state": {
        const sessionId = requireSessionId(command);
        return success(requestId, "get_state", runtime.getState(sessionId));
      }

      case "set_model": {
        const sessionId = requireSessionId(command);
        const provider = requireNonEmptyString(command.provider, "provider");
        const modelId = requireNonEmptyString(command.modelId, "modelId");
        return success(
          requestId,
          "set_model",
          await runtime.setModel(sessionId, provider, modelId),
        );
      }

      case "cycle_model": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "cycle_model",
          await runtime.cycleModel(sessionId),
        );
      }

      case "set_thinking_level": {
        const sessionId = requireSessionId(command);
        const level = requireNonEmptyString(command.level, "level");
        return success(
          requestId,
          "set_thinking_level",
          runtime.setThinkingLevel(sessionId, level),
        );
      }

      case "get_available_models": {
        return success(
          requestId,
          "get_available_models",
          await runtime.getAvailableModels(),
        );
      }

      case "oauth_list_providers": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "oauth_list_providers",
          runtime.listOAuthProviders(sessionId),
        );
      }

      case "oauth_start_login": {
        const sessionId = requireSessionId(command);
        const provider = requireNonEmptyString(command.provider, "provider");
        return success(
          requestId,
          "oauth_start_login",
          runtime.startOAuthLogin(sessionId, provider),
        );
      }

      case "oauth_poll_login": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "oauth_poll_login",
          runtime.pollOAuthLogin(sessionId),
        );
      }

      case "oauth_submit_login_input": {
        const sessionId = requireSessionId(command);
        const message =
          typeof command.message === "string" ? command.message : "";
        return success(
          requestId,
          "oauth_submit_login_input",
          runtime.submitOAuthLoginInput(sessionId, message),
        );
      }

      case "oauth_cancel_login": {
        const sessionId = requireSessionId(command);
        return success(
          requestId,
          "oauth_cancel_login",
          runtime.cancelOAuthLogin(sessionId),
        );
      }

      case "oauth_logout": {
        const sessionId = requireSessionId(command);
        const provider = requireNonEmptyString(command.provider, "provider");
        return success(
          requestId,
          "oauth_logout",
          runtime.logoutOAuthProvider(sessionId, provider),
        );
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
        return failure(
          requestId,
          unknownType,
          `Unknown command: ${unknownType}`,
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const commandType = (command as { type?: string }).type ?? "unknown";
    return failure(requestId, commandType, message);
  }
}
