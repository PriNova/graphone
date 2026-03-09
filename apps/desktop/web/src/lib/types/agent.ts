// Types for pi-mono RPC integration

export interface PromptImageAttachment {
  type: "image";
  data: string;
  mimeType: string;
}

// Canonical pi-ai-aligned tool-call shape.
// `result` / `isError` are Graphone UI preview fields (transitional, non-canonical).
export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  thoughtSignature?: string;

  // UI-only convenience fields (derived from ToolResultMessage)
  result?: string;
  isError?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  isRunning?: boolean;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type ToolResultContentBlock = TextBlock | PromptImageAttachment;

// Canonical pi-ai-aligned tool-result message.
export interface ToolResultMessage<TDetails = unknown> {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: ToolResultContentBlock[];
  details?: TDetails;
  isError: boolean;
  timestamp: number;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCall;

export type UserContentBlock = TextBlock | PromptImageAttachment;

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  timestamp: number;
}

export type Message =
  | { id: string; type: "user"; content: UserContentBlock[]; timestamp: Date }
  | {
      id: string;
      type: "assistant";
      content: ContentBlock[];
      timestamp: Date;
      isStreaming?: boolean;
    };

// Helper type guards
export function isTextBlock(block: ContentBlock): block is TextBlock {
  return block.type === "text";
}

export function isThinkingBlock(block: ContentBlock): block is ThinkingBlock {
  return block.type === "thinking";
}

export function isToolCall(block: ContentBlock): block is ToolCall {
  return block.type === "toolCall";
}

interface AgentEventMessagePayload {
  role: "user" | "assistant" | "toolResult";
  content?: string | unknown[];
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  details?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

// RPC Event types - aligned with pi-mono AgentEvent
export interface AgentMessageStartEvent {
  type: "message_start";
  message: AgentEventMessagePayload;
}

export interface AgentMessageUpdateEvent {
  type: "message_update";
  message: AssistantMessage;
  assistantMessageEvent: {
    type:
      | "text_start"
      | "text_delta"
      | "text_end"
      | "thinking_start"
      | "thinking_delta"
      | "thinking_end"
      | "toolcall_start"
      | "toolcall_delta"
      | "toolcall_end"
      | "start"
      | "done"
      | "error";
    contentIndex?: number;
    delta?: string;
    content?: string;
    thinking?: string;
    toolCall?: ToolCall;
    partial?: unknown;
  };
}

export interface AgentMessageEndEvent {
  type: "message_end";
  message: AgentEventMessagePayload;
}

export interface AgentStartEvent {
  type: "agent_start";
}

export interface AgentEndEvent {
  type: "agent_end";
}

export interface TurnStartEvent {
  type: "turn_start";
  turnIndex: number;
  timestamp: number;
}

export interface TurnEndEvent {
  type: "turn_end";
  turnIndex: number;
  message: AssistantMessage;
  toolResults: ToolResultMessage[];
}

export interface ToolExecutionStartEvent {
  type: "tool_execution_start";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolExecutionUpdateEvent {
  type: "tool_execution_update";
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  partialResult: unknown;
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export interface AutoCompactionStartEvent {
  type: "auto_compaction_start";
  reason: "threshold" | "overflow";
}

export interface AutoCompactionEndEvent {
  type: "auto_compaction_end";
  aborted: boolean;
  willRetry: boolean;
  errorMessage?: string;
  result?: {
    summary?: string;
    tokensBefore?: number;
  } | null;
}

export interface AutoRetryStartEvent {
  type: "auto_retry_start";
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  errorMessage: string;
}

export interface AutoRetryEndEvent {
  type: "auto_retry_end";
  success: boolean;
  attempt: number;
  finalError?: string;
}

export type AgentEvent =
  | AgentMessageStartEvent
  | AgentMessageUpdateEvent
  | AgentMessageEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecutionStartEvent
  | ToolExecutionUpdateEvent
  | ToolExecutionEndEvent
  | AutoCompactionStartEvent
  | AutoCompactionEndEvent
  | AutoRetryStartEvent
  | AutoRetryEndEvent;
