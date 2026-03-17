/**
 * Per-session prompt draft state management.
 * Tracks text drafts and image attachment drafts per session,
 * with automatic cleanup of stale session entries.
 */

import type { PromptImageAttachment } from "$lib/types/agent";

export class PromptDraftStore {
  private textDrafts = $state<Record<string, string>>({});
  private attachmentDrafts = $state<Record<string, PromptImageAttachment[]>>(
    {},
  );
  private static readonly EMPTY_ATTACHMENTS: PromptImageAttachment[] = [];

  /** Get the text draft for a session. */
  getText(sessionId: string | null | undefined): string {
    if (!sessionId) return "";
    return this.textDrafts[sessionId] ?? "";
  }

  /** Get the attachment draft for a session. */
  getAttachments(
    sessionId: string | null | undefined,
  ): PromptImageAttachment[] {
    if (!sessionId) return PromptDraftStore.EMPTY_ATTACHMENTS;
    return (
      this.attachmentDrafts[sessionId] ?? PromptDraftStore.EMPTY_ATTACHMENTS
    );
  }

  /** Set the text draft for a session. */
  setText(sessionId: string, text: string): void {
    this.textDrafts = { ...this.textDrafts, [sessionId]: text };
  }

  /** Set the attachment draft for a session. */
  setAttachments(
    sessionId: string,
    attachments: PromptImageAttachment[],
  ): void {
    this.attachmentDrafts = {
      ...this.attachmentDrafts,
      [sessionId]: attachments,
    };
  }

  /** Remove drafts for a closed session. */
  cleanupSession(sessionId: string): void {
    if (Object.hasOwn(this.textDrafts, sessionId)) {
      const remaining = { ...this.textDrafts };
      delete remaining[sessionId];
      this.textDrafts = remaining;
    }

    if (Object.hasOwn(this.attachmentDrafts, sessionId)) {
      const remaining = { ...this.attachmentDrafts };
      delete remaining[sessionId];
      this.attachmentDrafts = remaining;
    }
  }

  /**
   * Remove drafts for sessions that no longer exist.
   * Call this when the session list changes.
   */
  reconcile(validSessionIds: Set<string>): void {
    const textEntries = Object.entries(this.textDrafts).filter(([sessionId]) =>
      validSessionIds.has(sessionId),
    );
    if (textEntries.length !== Object.keys(this.textDrafts).length) {
      this.textDrafts = Object.fromEntries(textEntries);
    }

    const attachmentEntries = Object.entries(this.attachmentDrafts).filter(
      ([sessionId]) => validSessionIds.has(sessionId),
    );
    if (
      attachmentEntries.length !== Object.keys(this.attachmentDrafts).length
    ) {
      this.attachmentDrafts = Object.fromEntries(attachmentEntries);
    }
  }
}
