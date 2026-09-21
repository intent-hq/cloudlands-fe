import { safeLocalStorage } from '$lib/utils/safe-storage';

const KEY_PREFIX = 'chat.proposalDraft/';
const LEGACY_KEY_PREFIX = 'chat.proposalTray/';
const RECORD_VERSION = 1;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export interface ProposalCardDraft {
  fieldValues: Record<string, string>;
  selectedBulkItemIds: string[];
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

function draftKey(agentId: string, proposalId: string, prefix = KEY_PREFIX): string {
  return `${prefix}${agentId}/draft/${encodeURIComponent(proposalId)}`;
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

function pruneStaleEntries(skipKey: string): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const key of safeLocalStorage.keysWithPrefix(KEY_PREFIX)) {
    if (key === skipKey) continue;
    const stored = safeLocalStorage.getJSON<StoredRecord<unknown>>(key);
    if (!stored || typeof stored.savedAt !== 'number' || stored.savedAt < cutoff) {
      safeLocalStorage.removeItem(key);
    }
  }
  for (const key of safeLocalStorage.keysWithPrefix(LEGACY_KEY_PREFIX)) {
    safeLocalStorage.removeItem(key);
  }
}

export function loadProposalDraft(agentId: string, proposalId: string): ProposalCardDraft | null {
  const key = draftKey(agentId, proposalId);
  const legacyKey = draftKey(agentId, proposalId, LEGACY_KEY_PREFIX);
  let raw = safeLocalStorage.getItem(key);
  const loadedFromLegacy = raw === null;
  if (loadedFromLegacy) raw = safeLocalStorage.getItem(legacyKey);
  if (raw === null) return null;
  try {
    const record = JSON.parse(raw) as Partial<StoredRecord<unknown>> | null;
    if (
      !record ||
      record.version !== RECORD_VERSION ||
      typeof record.savedAt !== 'number' ||
      !isCardDraft(record.value)
    ) {
      safeLocalStorage.removeItem(loadedFromLegacy ? legacyKey : key);
      return null;
    }
    if (loadedFromLegacy) {
      safeLocalStorage.setItem(key, raw);
      safeLocalStorage.removeItem(legacyKey);
    }
    return record.value;
  } catch {
    safeLocalStorage.removeItem(loadedFromLegacy ? legacyKey : key);
    return null;
  }
}

export function saveProposalDraft(
  agentId: string,
  proposalId: string,
  draft: ProposalCardDraft,
): void {
  const key = draftKey(agentId, proposalId);
  pruneStaleEntries(key);
  safeLocalStorage.setJSON(key, { version: RECORD_VERSION, savedAt: Date.now(), value: draft });
}

export function clearProposalDraft(agentId: string, proposalId: string): void {
  safeLocalStorage.removeItem(draftKey(agentId, proposalId));
  safeLocalStorage.removeItem(draftKey(agentId, proposalId, LEGACY_KEY_PREFIX));
}
