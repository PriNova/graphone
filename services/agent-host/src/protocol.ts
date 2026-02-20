export type HostCommandType =
  | "create_session"
  | "close_session"
  | "list_sessions"
  | "prompt"
  | "steer"
  | "follow_up"
  | "abort"
  | "new_session"
  | "get_messages"
  | "get_state"
  | "set_model"
  | "cycle_model"
  | "get_available_models"
  | "set_thinking_level"
  | "shutdown"
  | "ping";

export interface HostCommandBase {
  id?: string;
  type: HostCommandType | string;
  sessionId?: string;
}

export interface CreateSessionCommand extends HostCommandBase {
  type: "create_session";
  cwd: string;
  provider?: string;
  modelId?: string;
  sessionFile?: string;
}

export interface HostImageAttachment {
  type: "image";
  data: string;
  mimeType: string;
}

export interface PromptCommand extends HostCommandBase {
  type: "prompt";
  message: string;
  images?: HostImageAttachment[];
  streamingBehavior?: "steer" | "followUp";
}

export interface SessionMessageCommand extends HostCommandBase {
  type: "steer" | "follow_up";
  message: string;
  images?: HostImageAttachment[];
}

export interface SetModelCommand extends HostCommandBase {
  type: "set_model";
  provider: string;
  modelId: string;
}

export interface SetThinkingLevelCommand extends HostCommandBase {
  type: "set_thinking_level";
  level: string;
}

export type HostCommand =
  | CreateSessionCommand
  | PromptCommand
  | SessionMessageCommand
  | SetModelCommand
  | SetThinkingLevelCommand
  | (HostCommandBase & {
      type:
        | "close_session"
        | "list_sessions"
        | "abort"
        | "new_session"
        | "get_messages"
        | "get_state"
        | "cycle_model"
        | "get_available_models"
        | "shutdown"
        | "ping";
    });

export interface HostResponse {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface SessionEventEnvelope {
  type: "session_event";
  sessionId: string;
  event: unknown;
}

export interface HostedSessionInfo {
  sessionId: string;
  cwd: string;
  createdAt: number;
  model?: { provider: string; id: string };
  busy: boolean;
  sessionFile?: string;
}

export function success(
  id: string | undefined,
  command: string,
  data?: unknown,
): HostResponse {
  if (data === undefined) {
    return { id, type: "response", command, success: true };
  }

  return { id, type: "response", command, success: true, data };
}

export function failure(
  id: string | undefined,
  command: string,
  error: string,
): HostResponse {
  return {
    id,
    type: "response",
    command,
    success: false,
    error,
  };
}
