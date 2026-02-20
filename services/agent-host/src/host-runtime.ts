import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@mariozechner/pi-ai";

import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";

import type { HostedSession } from "./session-runtime.js";
import type { HostedSessionInfo, SessionEventEnvelope } from "./protocol.js";

const THINKING_LEVELS = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

type ContextSeverity = "normal" | "warning" | "error";

interface UsageIndicatorSnapshot {
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  usingSubscription: boolean;
  contextPercent: number | null;
  contextWindow: number;
  autoCompactionEnabled: boolean;
  tokenStatsText: string;
  contextText: string;
  fullText: string;
  contextSeverity: ContextSeverity;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

export class HostRuntime {
  private readonly sessions = new Map<string, HostedSession>();
  private readonly authStorage = AuthStorage.create();
  private readonly modelRegistry = new ModelRegistry(this.authStorage);

  constructor(
    private readonly emitSessionEvent: (event: SessionEventEnvelope) => void,
  ) {}

  async createSession(args: {
    sessionId?: string;
    cwd: string;
    provider?: string;
    modelId?: string;
    sessionFile?: string;
  }): Promise<{
    sessionId: string;
    cwd: string;
    modelFallbackMessage?: string;
    sessionFile?: string;
  }> {
    const sessionId = (args.sessionId?.trim() || randomUUID()).trim();
    if (!sessionId) {
      throw new Error("sessionId cannot be empty");
    }

    const existing = this.sessions.get(sessionId);
    if (existing) {
      return {
        sessionId: existing.sessionId,
        cwd: existing.cwd,
      };
    }

    const fallbackCwd = this.validateCwd(args.cwd);

    const sessionManager = args.sessionFile
      ? SessionManager.open(this.validateSessionFile(args.sessionFile))
      : SessionManager.create(fallbackCwd);

    const resolvedCwd = this.validateCwd(sessionManager.getCwd());

    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: resolvedCwd,
      sessionManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
    });

    const unsubscribe = session.subscribe((event) => {
      this.emitSessionEvent({
        type: "session_event",
        sessionId,
        event: this.compactSessionEventForWire(event),
      });
    });

    this.sessions.set(sessionId, {
      sessionId,
      cwd: resolvedCwd,
      createdAt: Date.now(),
      session,
      unsubscribe,
    });

    if (args.provider && args.modelId) {
      try {
        await this.setModel(sessionId, args.provider, args.modelId);
      } catch (error) {
        await this.closeSession(sessionId);
        throw error;
      }
    }

    return {
      sessionId,
      cwd: resolvedCwd,
      modelFallbackMessage,
      sessionFile: session.sessionFile,
    };
  }

  async closeSession(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId);
    if (!hosted) {
      throw new Error(`Unknown sessionId: ${sessionId}`);
    }

    hosted.unsubscribe();
    hosted.session.dispose();
    this.sessions.delete(sessionId);
  }

  listSessions(): HostedSessionInfo[] {
    return Array.from(this.sessions.values())
      .map((hosted) => this.toSessionInfo(hosted))
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  async prompt(
    sessionId: string,
    message: string,
    images?: ImageContent[],
    streamingBehavior?: "steer" | "followUp",
  ): Promise<void> {
    const session = this.requireSession(sessionId, "prompt");

    // Fire-and-forget to keep prompt acknowledgements immediate,
    // matching RPC mode behavior where streaming continues via events.
    session
      .prompt(message, {
        images,
        streamingBehavior,
        source: "rpc",
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[pi-agent-host] prompt failed for session ${sessionId}: ${message}`,
        );
      });
  }

  async steer(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "steer");
    await session.steer(message, images);
  }

  async followUp(
    sessionId: string,
    message: string,
    images?: ImageContent[],
  ): Promise<void> {
    const session = this.requireSession(sessionId, "follow_up");
    await session.followUp(message, images);
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId, "abort");
    await session.abort();
  }

  async newSession(sessionId: string): Promise<{ cancelled: boolean }> {
    const session = this.requireSession(sessionId, "new_session");
    const cancelled = !(await session.newSession());
    return { cancelled };
  }

  getMessages(sessionId: string): { messages: AgentSession["messages"] } {
    const session = this.requireSession(sessionId, "get_messages");
    return {
      messages: session.messages,
    };
  }

  getState(sessionId: string): {
    model?: unknown;
    thinkingLevel: string;
    supportsThinking: boolean;
    availableThinkingLevels: ThinkingLevel[];
    isStreaming: boolean;
    isCompacting: boolean;
    steeringMode: "all" | "one-at-a-time";
    followUpMode: "all" | "one-at-a-time";
    sessionFile?: string;
    sessionId: string;
    sessionName?: string;
    autoCompactionEnabled: boolean;
    messageCount: number;
    pendingMessageCount: number;
    usageIndicator: UsageIndicatorSnapshot;
  } {
    const session = this.requireSession(sessionId, "get_state");
    return {
      model: session.model,
      thinkingLevel: session.thinkingLevel,
      supportsThinking: session.supportsThinking(),
      availableThinkingLevels: session.getAvailableThinkingLevels(),
      isStreaming: session.isStreaming,
      isCompacting: session.isCompacting,
      steeringMode: session.steeringMode,
      followUpMode: session.followUpMode,
      sessionFile: session.sessionFile,
      sessionId: session.sessionId,
      sessionName: session.sessionName,
      autoCompactionEnabled: session.autoCompactionEnabled,
      messageCount: session.messages.length,
      pendingMessageCount: session.pendingMessageCount,
      usageIndicator: this.buildUsageIndicator(session),
    };
  }

  async setModel(
    sessionId: string,
    provider: string,
    modelId: string,
  ): Promise<unknown> {
    const session = this.requireSession(sessionId, "set_model");
    const models = await session.modelRegistry.getAvailable();
    const model = models.find(
      (m) => m.provider === provider && m.id === modelId,
    );

    if (!model) {
      throw new Error(`Model not found: ${provider}/${modelId}`);
    }

    await session.setModel(model);
    return model;
  }

  async cycleModel(sessionId: string): Promise<unknown | null> {
    const session = this.requireSession(sessionId, "cycle_model");
    return (await session.cycleModel()) ?? null;
  }

  setThinkingLevel(
    sessionId: string,
    level: string,
  ): {
    level: ThinkingLevel;
    supportsThinking: boolean;
    availableThinkingLevels: ThinkingLevel[];
  } {
    const session = this.requireSession(sessionId, "set_thinking_level");
    const normalized = level.trim().toLowerCase();

    if (!THINKING_LEVELS.has(normalized as ThinkingLevel)) {
      throw new Error(
        `Invalid thinking level: ${level}. Valid levels: off, minimal, low, medium, high, xhigh`,
      );
    }

    session.setThinkingLevel(normalized as ThinkingLevel);

    return {
      level: session.thinkingLevel,
      supportsThinking: session.supportsThinking(),
      availableThinkingLevels: session.getAvailableThinkingLevels(),
    };
  }

  async getAvailableModels(): Promise<{
    models: Array<{
      provider: string;
      id: string;
      name: string;
      supportsImageInput: boolean;
    }>;
  }> {
    const models = await this.modelRegistry.getAvailable();

    return {
      models: models.map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name || model.id,
        supportsImageInput: (model.input ?? []).includes("image"),
      })),
    };
  }

  async shutdown(): Promise<void> {
    const sessionIds = Array.from(this.sessions.keys());
    for (const sessionId of sessionIds) {
      await this.closeSession(sessionId);
    }
  }

  private buildUsageIndicator(session: AgentSession): UsageIndicatorSnapshot {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;

    for (const entry of session.sessionManager.getEntries()) {
      if (entry.type !== "message" || entry.message.role !== "assistant") {
        continue;
      }

      const assistantMessage = entry.message as AssistantMessage;
      const usage = assistantMessage.usage;
      if (!usage) {
        continue;
      }

      totalInput += usage.input;
      totalOutput += usage.output;
      totalCacheRead += usage.cacheRead;
      totalCacheWrite += usage.cacheWrite;
      totalCost += usage.cost.total;
    }

    const contextUsage = session.getContextUsage();
    const contextWindow =
      contextUsage?.contextWindow ?? session.model?.contextWindow ?? 0;
    const contextPercentValue = contextUsage?.percent ?? 0;
    const contextPercentDisplay =
      contextUsage?.percent !== null ? contextPercentValue.toFixed(1) : "?";

    const usingSubscription = session.model
      ? session.modelRegistry.isUsingOAuth(session.model)
      : false;

    const tokenParts: string[] = [];
    if (totalInput) tokenParts.push(`↑${formatTokens(totalInput)}`);
    if (totalOutput) tokenParts.push(`↓${formatTokens(totalOutput)}`);
    if (totalCacheRead) tokenParts.push(`R${formatTokens(totalCacheRead)}`);
    if (totalCacheWrite) tokenParts.push(`W${formatTokens(totalCacheWrite)}`);
    if (totalCost || usingSubscription) {
      tokenParts.push(
        `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`,
      );
    }

    const autoIndicator = session.autoCompactionEnabled ? " (auto)" : "";
    const contextText =
      contextPercentDisplay === "?"
        ? `?/${formatTokens(contextWindow)}${autoIndicator}`
        : `${contextPercentDisplay}%/${formatTokens(contextWindow)}${autoIndicator}`;

    const tokenStatsText = tokenParts.join(" ");
    const fullText = tokenStatsText
      ? `${tokenStatsText} ${contextText}`
      : contextText;

    const contextSeverity: ContextSeverity =
      contextPercentValue > 90
        ? "error"
        : contextPercentValue > 70
          ? "warning"
          : "normal";

    return {
      totalInput,
      totalOutput,
      totalCacheRead,
      totalCacheWrite,
      totalCost,
      usingSubscription,
      contextPercent: contextUsage?.percent ?? null,
      contextWindow,
      autoCompactionEnabled: session.autoCompactionEnabled,
      tokenStatsText,
      contextText,
      fullText,
      contextSeverity,
    };
  }

  private compactSessionEventForWire(event: unknown): unknown {
    if (!event || typeof event !== "object") {
      return event;
    }

    const eventType = (event as { type?: unknown }).type;
    if (eventType === "agent_end") {
      return { type: "agent_end" };
    }

    return event;
  }

  private toSessionInfo(hosted: HostedSession): HostedSessionInfo {
    const model = hosted.session.model
      ? { provider: hosted.session.model.provider, id: hosted.session.model.id }
      : undefined;

    return {
      sessionId: hosted.sessionId,
      cwd: hosted.cwd,
      createdAt: hosted.createdAt,
      model,
      busy: hosted.session.isStreaming,
      sessionFile: hosted.session.sessionFile,
    };
  }

  private requireSession(
    sessionId: string | undefined,
    command: string,
  ): AgentSession {
    const normalized = sessionId?.trim();
    if (!normalized) {
      throw new Error(`sessionId is required for ${command}`);
    }

    const hosted = this.sessions.get(normalized);
    if (!hosted) {
      throw new Error(`Unknown sessionId: ${normalized}`);
    }

    return hosted.session;
  }

  private validateCwd(cwd: string): string {
    const normalized = resolve(cwd);

    if (!existsSync(normalized)) {
      throw new Error(`Directory does not exist: ${normalized}`);
    }

    const stats = statSync(normalized);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${normalized}`);
    }

    return normalized;
  }

  private validateSessionFile(sessionFile: string): string {
    const normalized = resolve(sessionFile);

    if (!existsSync(normalized)) {
      throw new Error(`Session file does not exist: ${normalized}`);
    }

    const stats = statSync(normalized);
    if (!stats.isFile()) {
      throw new Error(`Session file path is not a file: ${normalized}`);
    }

    return normalized;
  }
}
