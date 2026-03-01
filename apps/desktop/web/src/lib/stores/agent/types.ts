export interface AvailableModel {
  provider: string;
  id: string;
  name: string;
  supportsImageInput: boolean;
}

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export const VALID_THINKING_LEVELS: ReadonlySet<ThinkingLevel> = new Set<ThinkingLevel>([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export type UsageContextSeverity = "normal" | "warning" | "error";

export interface UsageIndicatorSnapshot {
  tokenStatsText: string;
  contextText: string;
  fullText: string;
  contextSeverity: UsageContextSeverity;
}

export interface OAuthProviderStatus {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
}

export type OAuthLoginStatus =
  | "idle"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type OAuthLoginUpdate =
  | { type: "auth"; url: string; instructions?: string }
  | {
      type: "prompt";
      message: string;
      placeholder?: string;
      allowEmpty: boolean;
      inputType: "prompt" | "manual_code";
    }
  | { type: "progress"; message: string }
  | { type: "complete"; success: boolean; error?: string };

export interface OAuthLoginPollResult {
  status: OAuthLoginStatus;
  provider?: string;
  updates: OAuthLoginUpdate[];
}
