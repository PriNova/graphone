import { describeSessionAttentionTone } from "$lib/session/session-state-presentation";
import type { PersistedSessionHistoryItem } from "$lib/stores/projectScopes.svelte";
import type { SessionDescriptor } from "$lib/stores/sessions.svelte";

export interface SessionTabView {
  sessionId: string;
  label: string;
  tooltip: string;
  accessibleLabel: string;
  isBusy: boolean;
  needsReview: boolean;
  isDetached: boolean;
}

interface DeriveSessionTabsArgs {
  sessions: SessionDescriptor[];
  tabOrder?: string[];
  scopeHistoryByProject?: Record<string, PersistedSessionHistoryItem[]>;
  busySessionIds?: Iterable<string>;
  reviewSessionIds?: Iterable<string>;
  detachedSessionIds?: Iterable<string>;
}

interface SessionTabBaseMeta {
  session: SessionDescriptor;
  projectTitle: string;
  fullLabel: string;
}

function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function shortSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  return trimmed.length > 8 ? trimmed.slice(0, 8) : trimmed;
}

function normalizeLabelKey(value: string): string {
  return collapseWhitespace(value).toLocaleLowerCase();
}

function sanitizeDomIdToken(value: string): string {
  const sanitized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-");
  return sanitized.length > 0 ? sanitized : "session";
}

function findHistoryForSession(
  session: SessionDescriptor,
  scopeHistoryByProject: Record<string, PersistedSessionHistoryItem[]>,
): PersistedSessionHistoryItem | null {
  const sessionFile = session.sessionFile?.trim() ?? "";
  const sessionId = session.sessionId.trim();

  for (const history of Object.values(scopeHistoryByProject).flat()) {
    if (sessionFile.length > 0 && history.filePath.trim() === sessionFile) {
      return history;
    }

    if (sessionId.length > 0 && history.sessionId.trim() === sessionId) {
      return history;
    }
  }

  return null;
}

function toBaseMeta(
  session: SessionDescriptor,
  scopeHistoryByProject: Record<string, PersistedSessionHistoryItem[]>,
): SessionTabBaseMeta {
  const history = findHistoryForSession(session, scopeHistoryByProject);
  const preview = collapseWhitespace(history?.firstUserMessage);
  const projectTitle = collapseWhitespace(session.title) || "Untitled session";
  const fullLabel = preview || projectTitle || `Session ${session.sessionId}`;

  return {
    session,
    projectTitle,
    fullLabel,
  };
}

function buildTooltip(
  meta: SessionTabBaseMeta,
  label: string,
  state: {
    isBusy: boolean;
    needsReview: boolean;
    isDetached: boolean;
  },
): string {
  const parts = [collapseWhitespace(label || meta.fullLabel)];

  parts.push(describeSessionAttentionTone(state));

  if (state.isDetached) {
    parts.push("Detached");
  }

  return parts.join(" • ");
}

function buildAccessibleLabel(
  label: string,
  state: {
    isBusy: boolean;
    needsReview: boolean;
    isDetached: boolean;
  },
): string {
  const statusParts: string[] = [];

  if (state.isBusy) {
    statusParts.push("busy");
  }

  if (state.needsReview) {
    statusParts.push("needs review");
  }

  if (state.isDetached) {
    statusParts.push("detached");
  }

  return statusParts.length > 0
    ? `${label} (${statusParts.join(", ")})`
    : label;
}

function orderSessions(
  sessions: SessionDescriptor[],
  tabOrder: string[],
): SessionDescriptor[] {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const ordered: SessionDescriptor[] = [];
  const seen = new Set<string>();

  for (const sessionId of tabOrder) {
    const session = byId.get(sessionId);
    if (!session || seen.has(session.sessionId)) {
      continue;
    }

    ordered.push(session);
    seen.add(session.sessionId);
  }

  for (const session of sessions) {
    if (seen.has(session.sessionId)) {
      continue;
    }

    ordered.push(session);
    seen.add(session.sessionId);
  }

  return ordered;
}

export function sessionTabDomId(sessionId: string): string {
  return `graphone-session-tab-${sanitizeDomIdToken(sessionId)}`;
}

export function sessionPanelDomId(sessionId: string): string {
  return `graphone-session-panel-${sanitizeDomIdToken(sessionId)}`;
}

export function deriveSessionTabs({
  sessions,
  tabOrder = [],
  scopeHistoryByProject = {},
  busySessionIds = [],
  reviewSessionIds = [],
  detachedSessionIds = [],
}: DeriveSessionTabsArgs): SessionTabView[] {
  const orderedSessions = orderSessions(sessions, tabOrder);
  const base = orderedSessions.map((session) =>
    toBaseMeta(session, scopeHistoryByProject),
  );
  const duplicateCounts = new Map<string, number>();
  const busySet = new Set(Array.from(busySessionIds));
  const reviewSet = new Set(Array.from(reviewSessionIds));
  const detachedSet = new Set(Array.from(detachedSessionIds));

  for (const tab of base) {
    const key = normalizeLabelKey(tab.fullLabel);
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  }

  return base.map((tab) => {
    const duplicateKey = normalizeLabelKey(tab.fullLabel);
    const isDuplicate = (duplicateCounts.get(duplicateKey) ?? 0) > 1;
    const label = isDuplicate
      ? `${tab.fullLabel} · ${shortSessionId(tab.session.sessionId)}`
      : tab.fullLabel;
    const isBusy = busySet.has(tab.session.sessionId);
    const needsReview = reviewSet.has(tab.session.sessionId);
    const isDetached = detachedSet.has(tab.session.sessionId);

    return {
      sessionId: tab.session.sessionId,
      label,
      tooltip: buildTooltip(tab, label, {
        isBusy,
        needsReview,
        isDetached,
      }),
      accessibleLabel: buildAccessibleLabel(label, {
        isBusy,
        needsReview,
        isDetached,
      }),
      isBusy,
      needsReview,
      isDetached,
    } satisfies SessionTabView;
  });
}
