import type { AgentSession } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage } from "@mariozechner/pi-ai";

export type ContextSeverity = "normal" | "warning" | "error";

export interface UsageIndicatorSnapshot {
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

export function buildUsageIndicator(
  session: AgentSession,
): UsageIndicatorSnapshot {
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
    tokenParts.push(`$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`);
  }

  const autoIndicator = session.autoCompactionEnabled ? " (auto)" : "";
  const contextText =
    contextPercentDisplay === "?"
      ? `?/${formatTokens(contextWindow)}${autoIndicator}`
      : `${contextPercentDisplay}%/${formatTokens(contextWindow)}${autoIndicator}`;

  const tokenStatsText = tokenParts.join(" ");
  const fullText = tokenStatsText ? `${tokenStatsText} ${contextText}` : contextText;

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
