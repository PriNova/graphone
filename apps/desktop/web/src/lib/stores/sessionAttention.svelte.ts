import { LazyStore } from "@tauri-apps/plugin-store";

export interface SessionAttentionSubject {
  sessionFile?: string | null;
  persistedSessionId?: string | null;
  sessionId?: string | null;
}

interface SessionAttentionEntry {
  completedSeq: number;
  seenSeq: number;
}

const STORE_FILE = "session-attention.json";
const CURRENT_VERSION = 1;

function normalizeFilePath(filePath: string | null | undefined): string | null {
  const trimmed = filePath?.trim() ?? "";
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed.replace(/\\/g, "/").replace(/\/+/g, "/");
}

function normalizeIdentifier(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function buildAttentionKeys(
  subject: SessionAttentionSubject | null | undefined,
): string[] {
  if (!subject) {
    return [];
  }

  const keys: string[] = [];
  const seen = new Set<string>();

  const pushKey = (key: string | null): void => {
    if (!key || seen.has(key)) {
      return;
    }

    seen.add(key);
    keys.push(key);
  };

  pushKey(
    normalizeFilePath(subject.sessionFile)
      ? `file:${normalizeFilePath(subject.sessionFile)}`
      : null,
  );
  pushKey(
    normalizeIdentifier(subject.persistedSessionId)
      ? `persisted:${normalizeIdentifier(subject.persistedSessionId)}`
      : null,
  );
  pushKey(
    normalizeIdentifier(subject.sessionId)
      ? `session:${normalizeIdentifier(subject.sessionId)}`
      : null,
  );

  return keys;
}

function normalizeEntry(value: unknown): SessionAttentionEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const completedSeq = (value as { completedSeq?: unknown }).completedSeq;
  const seenSeq = (value as { seenSeq?: unknown }).seenSeq;

  return {
    completedSeq:
      typeof completedSeq === "number" && Number.isFinite(completedSeq)
        ? Math.max(0, Math.trunc(completedSeq))
        : 0,
    seenSeq:
      typeof seenSeq === "number" && Number.isFinite(seenSeq)
        ? Math.max(0, Math.trunc(seenSeq))
        : 0,
  };
}

function normalizeEntries(
  value: unknown,
): Record<string, SessionAttentionEntry> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const normalized: Record<string, SessionAttentionEntry> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (typeof key !== "string" || key.trim().length === 0) {
      continue;
    }

    const normalizedEntry = normalizeEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    normalized[key] = normalizedEntry;
  }

  return normalized;
}

export class SessionAttentionStore {
  private store = new LazyStore(STORE_FILE, {
    defaults: {},
    autoSave: 100,
  });

  entries = $state<Record<string, SessionAttentionEntry>>({});
  nextSeq = $state(0);
  loaded = $state(false);
  error = $state<string | null>(null);

  private loadPromise: Promise<void> | null = null;

  load(): Promise<void> {
    if (this.loadPromise) {
      return this.loadPromise;
    }

    this.loadPromise = this.loadInternal().finally(() => {
      this.loadPromise = null;
    });

    return this.loadPromise;
  }

  private async loadInternal(): Promise<void> {
    try {
      await this.store.init();

      const [version, nextSeq, entries] = await Promise.all([
        this.store.get<number>("attention.version"),
        this.store.get<number>("attention.nextSeq"),
        this.store.get<Record<string, SessionAttentionEntry>>(
          "attention.entries",
        ),
      ]);

      this.entries = normalizeEntries(entries);
      this.nextSeq =
        version === CURRENT_VERSION &&
        typeof nextSeq === "number" &&
        Number.isFinite(nextSeq)
          ? Math.max(0, Math.trunc(nextSeq))
          : 0;
      this.loaded = true;
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      console.error("Failed to load session attention state:", error);
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }

    await this.load();
  }

  private getMergedEntry(keys: string[]): SessionAttentionEntry {
    let completedSeq = 0;
    let seenSeq = 0;

    for (const key of keys) {
      const entry = this.entries[key];
      if (!entry) {
        continue;
      }

      completedSeq = Math.max(completedSeq, entry.completedSeq);
      seenSeq = Math.max(seenSeq, entry.seenSeq);
    }

    return {
      completedSeq,
      seenSeq,
    };
  }

  private bumpSequence(minValue = 0): number {
    this.nextSeq = Math.max(this.nextSeq + 1, minValue);
    return this.nextSeq;
  }

  private writeEntry(keys: string[], entry: SessionAttentionEntry): void {
    if (keys.length === 0) {
      return;
    }

    const nextEntries = { ...this.entries };
    for (const key of keys) {
      nextEntries[key] = { ...entry };
    }
    this.entries = nextEntries;
  }

  private async persist(): Promise<void> {
    await this.store.set("attention.version", CURRENT_VERSION);
    await this.store.set("attention.nextSeq", this.nextSeq);
    await this.store.set("attention.entries", this.entries);
  }

  needsReview(subject: SessionAttentionSubject | null | undefined): boolean {
    const keys = buildAttentionKeys(subject);
    if (keys.length === 0) {
      return false;
    }

    const entry = this.getMergedEntry(keys);
    return entry.completedSeq > entry.seenSeq;
  }

  countNeedsReview(
    subjects: Array<SessionAttentionSubject | null | undefined>,
  ): number {
    let count = 0;
    const seenPrimaryKeys = new Set<string>();

    for (const subject of subjects) {
      const keys = buildAttentionKeys(subject);
      const primaryKey = keys[0];
      if (!primaryKey || seenPrimaryKeys.has(primaryKey)) {
        continue;
      }

      seenPrimaryKeys.add(primaryKey);
      const entry = this.getMergedEntry(keys);
      if (entry.completedSeq > entry.seenSeq) {
        count += 1;
      }
    }

    return count;
  }

  async markCompleted(
    subject: SessionAttentionSubject | null | undefined,
  ): Promise<void> {
    const keys = buildAttentionKeys(subject);
    if (keys.length === 0) {
      return;
    }

    await this.ensureLoaded();

    const current = this.getMergedEntry(keys);
    const next: SessionAttentionEntry = {
      completedSeq: this.bumpSequence(
        Math.max(current.completedSeq, current.seenSeq) + 1,
      ),
      seenSeq: current.seenSeq,
    };

    this.writeEntry(keys, next);
    await this.persist();
    this.error = null;
  }

  async markSeen(
    subject: SessionAttentionSubject | null | undefined,
  ): Promise<void> {
    const keys = buildAttentionKeys(subject);
    if (keys.length === 0) {
      return;
    }

    await this.ensureLoaded();

    const current = this.getMergedEntry(keys);
    if (current.completedSeq <= current.seenSeq) {
      return;
    }

    const nextSeenSeq = this.bumpSequence(current.completedSeq);
    this.writeEntry(keys, {
      completedSeq: current.completedSeq,
      seenSeq: nextSeenSeq,
    });
    await this.persist();
    this.error = null;
  }

  async removeSubject(
    subject: SessionAttentionSubject | null | undefined,
  ): Promise<void> {
    const keys = buildAttentionKeys(subject);
    if (keys.length === 0) {
      return;
    }

    await this.ensureLoaded();

    let changed = false;
    const nextEntries = { ...this.entries };
    for (const key of keys) {
      if (!(key in nextEntries)) {
        continue;
      }

      delete nextEntries[key];
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.entries = nextEntries;
    await this.persist();
    this.error = null;
  }
}

export const sessionAttentionStore = new SessionAttentionStore();
