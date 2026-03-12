export interface SessionAttentionFlags {
  isBusy: boolean;
  needsReview: boolean;
}

export type SessionAttentionTone = "busy" | "review" | "idle";

export function getSessionAttentionTone({
  isBusy,
  needsReview,
}: SessionAttentionFlags): SessionAttentionTone {
  if (isBusy) {
    return "busy";
  }

  if (needsReview) {
    return "review";
  }

  return "idle";
}

export function describeSessionAttentionTone(
  flags: SessionAttentionFlags,
): string {
  const tone = getSessionAttentionTone(flags);

  if (tone === "busy") {
    return "Agent active";
  }

  if (tone === "review") {
    return "Needs review";
  }

  return "Agent idle";
}

export function sessionSidebarHistoryItemClass({
  isBusy,
  needsReview,
  isActive,
}: SessionAttentionFlags & {
  isActive: boolean;
}): string {
  if (isBusy) {
    return isActive
      ? "border-foreground bg-surface-active text-foreground border-l-4 border-l-success"
      : "border-border hover:bg-surface-hover border-l-2 border-l-success";
  }

  if (isActive) {
    return "border-foreground bg-surface-active text-foreground";
  }

  if (needsReview) {
    return "border-review hover:bg-surface-hover border-l-2 border-l-review";
  }

  return "border-border hover:bg-surface-hover";
}

export function sessionSidebarHistorySourceClass({
  isBusy,
  isActive,
}: SessionAttentionFlags & {
  isActive: boolean;
}): string {
  if (isBusy) {
    return "text-success font-semibold";
  }

  if (isActive) {
    return "text-foreground font-semibold";
  }

  return "text-muted-foreground";
}

export function sessionTabLabelClass(flags: SessionAttentionFlags): string {
  const tone = getSessionAttentionTone(flags);

  if (tone === "busy") {
    return "text-success";
  }

  if (tone === "review") {
    return "text-review";
  }

  return "text-muted-foreground";
}

export function sessionTabAccentClass(flags: SessionAttentionFlags): string {
  const tone = getSessionAttentionTone(flags);

  if (tone === "busy") {
    return "bg-success";
  }

  if (tone === "review") {
    return "bg-review";
  }

  return "bg-border";
}
