import { safeLocalStorage } from '$lib/utils/safe-storage';

/**
 * localStorage-backed persistence for the composer-slot proposal tray:
 * the host-owned collapsed (Hide) flag and last-viewed proposal (both per
 * agent), plus per-proposal transient edit drafts (editable field values,
 * bulk item selections, workspace-create text edits) that survive
 * unmounts/reloads and are cleared when the proposal resolves. Keys are
 * namespaced per agent (+ daemon-parity proposal id for drafts), so another
 * agent's tray never inherits state. Follows the `wizard-draft-storage`
 * pattern: versioned records, 14-day staleness prune before every write,
 * all access through `safeLocalStorage` (SSR-safe, failure-tolerant).
 */

const KEY_PREFIX = 'chat.proposalTray/';
const RECORD_VERSION = 1;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Transient, not-yet-applied edits made to a proposal card in the tray. */
export interface ProposalCardDraft {
  /** Generic editable-field values keyed by field key. */
  fieldValues: Record<string, string>;
  /** Selected bulk item ids (bulk-op proposals). */
  selectedBulkItemIds: string[];
  /** Workspace-create card text edits (subset restorable as plain text). */
  workspace?: {
    title: string;
    initialPrompt: string;
    branch: string;
    specialist: string | null;
  };
}

interface StoredRecord<T> {
  version: number;
  savedAt: number;
  value: T;
}

function collapsedKey(agentId: string): string {
  return `${KEY_PREFIX}${agentId}/collapsed`;
}

function positionKey(agentId: string): string {
  return `${KEY_PREFIX}${agentId}/position`;
}

/** Draft storage key for one proposal: namespaced per agent + proposal id. */
function trayDraftKey(agentId: string, proposalId: string): string {
  return `${KEY_PREFIX}${agentId}/draft/${encodeURIComponent(proposalId)}`;
}

function readRecord<T>(key: string, isValid: (value: unknown) => value is T): T | null {
  const raw = safeLocalStorage.getItem(key);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeLocalStorage.removeItem(key);
    return null;
  }
  const record = parsed as Partial<StoredRecord<unknown>> | null;
  if (
    !record ||
    typeof record !== 'object' ||
    record.version !== RECORD_VERSION ||
    typeof record.savedAt !== 'number' ||
    !isValid(record.value)
  ) {
    safeLocalStorage.removeItem(key);
    return null;
  }
  return record.value;
}

/**
 * Prune namespace entries older than 14 days, then persist. Pruning first
 * frees quota headroom so a near-full localStorage cannot fail the write
 * (`safeLocalStorage.setItem` swallows quota errors).
 */
function writeRecord<T>(key: string, value: T): void {
  pruneStaleEntries(key);
  const record: StoredRecord<T> = { version: RECORD_VERSION, savedAt: Date.now(), value };
  safeLocalStorage.setJSON(key, record);
}

function pruneStaleEntries(skipKey: string): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const key of safeLocalStorage.keysWithPrefix(KEY_PREFIX)) {
    if (key === skipKey) continue;
    const stored = safeLocalStorage.getJSON<StoredRecord<unknown>>(key);
    if (!stored || typeof stored.savedAt !== 'number' || stored.savedAt < cutoff) {
      safeLocalStorage.removeItem(key);
    }
  }
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function isCardDraft(value: unknown): value is ProposalCardDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ProposalCardDraft>;
  if (!isStringRecord(draft.fieldValues)) return false;
  if (
    !Array.isArray(draft.selectedBulkItemIds) ||
    !draft.selectedBulkItemIds.every((id) => typeof id === 'string')
  ) {
    return false;
  }
  if (draft.workspace === undefined) return true;
  const workspace = draft.workspace as Partial<NonNullable<ProposalCardDraft['workspace']>> | null;
  return (
    !!workspace &&
    typeof workspace === 'object' &&
    typeof workspace.title === 'string' &&
    typeof workspace.initialPrompt === 'string' &&
    typeof workspace.branch === 'string' &&
    (workspace.specialist === null || typeof workspace.specialist === 'string')
  );
}

/** Persisted collapsed (Hide) state for the agent's tray; null when unset. */
export function loadTrayCollapsed(agentId: string): boolean | null {
  return readRecord(collapsedKey(agentId), isBoolean);
}

export function saveTrayCollapsed(agentId: string, collapsed: boolean): void {
  writeRecord(collapsedKey(agentId), collapsed);
}

/** Last-viewed proposal id for the agent's tray; null when unset. */
export function loadTrayPosition(agentId: string): string | null {
  return readRecord(positionKey(agentId), isNonEmptyString);
}

export function saveTrayPosition(agentId: string, proposalId: string): void {
  writeRecord(positionKey(agentId), proposalId);
}

/** Restore the transient edit draft for one proposal; null when unset. */
export function loadTrayDraft(agentId: string, proposalId: string): ProposalCardDraft | null {
  return readRecord(trayDraftKey(agentId, proposalId), isCardDraft);
}

export function saveTrayDraft(agentId: string, proposalId: string, draft: ProposalCardDraft): void {
  writeRecord(trayDraftKey(agentId, proposalId), draft);
}

/** Delete one proposal's stored draft (the proposal resolved). */
export function clearTrayDraft(agentId: string, proposalId: string): void {
  safeLocalStorage.removeItem(trayDraftKey(agentId, proposalId));
}
