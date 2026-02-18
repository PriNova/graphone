// Types for pi-mono RPC integration

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  // Result populated when tool execution completes
  result?: string;
  isError?: boolean;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolCall;

export interface AssistantMessage {
  role: "assistant";
  content: ContentBlock[];
  timestamp: number;
}

export type Message =
  | { id: string; type: "user"; content: string; timestamp: Date }
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

// RPC Event types - aligned with pi-mono AgentEvent
export interface AgentMessageStartEvent {
  type: "message_start";
  message: {
    role: "user" | "assistant" | "toolResult";
    content?: string | unknown[];
    timestamp?: number;
    [key: string]: unknown;
  };
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
  message: {
    role: "user" | "assistant" | "toolResult";
    content?: string | unknown[];
    timestamp?: number;
    [key: string]: unknown;
  };
}

export interface AgentStartEvent {
  type: "agent_start";
}

export interface AgentEndEvent {
  type: "agent_end";
  messages: AssistantMessage[];
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
  toolResults: unknown[];
}

export interface ToolExecutionEndEvent {
  type: "tool_execution_end";
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError: boolean;
}

export type AgentEvent =
  | AgentMessageStartEvent
  | AgentMessageUpdateEvent
  | AgentMessageEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | TurnStartEvent
  | TurnEndEvent
  | ToolExecutionEndEvent;
