import { safeLocalStorage } from '$lib/utils/safe-storage';
import type { Question } from '$shared/types/question-resource';

/**
 * localStorage-backed draft persistence for the Agent Q&A wizard: the current
 * step index plus every step's in-progress answer (option selections,
 * free-form text, skipped flag) — and, in a sibling record, the host-owned
 * collapsed (Hide) state — survive unmounts and app reloads. Keys are
 * namespaced per agent + question-bearing assistant message id — the same id
 * ChatPanel keys wizard remounts on — so a different pending set never
 * inherits another set's draft. Dependency-light on purpose — no stores, no
 * components; all storage access goes through `safeLocalStorage` (SSR-safe,
 * failure-tolerant).
 */

const KEY_PREFIX = 'chat.questionWizardDraft/';
const DRAFT_VERSION = 1;
const MAX_DRAFT_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const COLLAPSED_SUFFIX = '/collapsed';

/** Mirrors the wizard's internal per-question `DraftAnswer` shape. */
interface WizardDraftAnswer {
  /** Selected option indices (selection order). */
  sel: number[];
  /** Raw free-form "Other" text. */
  text: string;
  /** True when the question was explicitly skipped. */
  skipped: boolean;
}

/** The restorable wizard state: step index + one draft answer per question. */
export interface WizardDraft {
  idx: number;
  answers: WizardDraftAnswer[];
}

interface StoredWizardDraft extends WizardDraft {
  version: number;
  savedAt: number;
}

/** Storage key for one question set: `chat.questionWizardDraft/{agentId}/{messageId}`. */
export function wizardDraftKey(agentId: string, messageId: string): string {
  return `${KEY_PREFIX}${agentId}/${messageId}`;
}

function isValidAnswer(value: unknown, question: Question): value is WizardDraftAnswer {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<WizardDraftAnswer>;
  return (
    Array.isArray(a.sel) &&
    a.sel.every(
      (oi) =>
        typeof oi === 'number' && Number.isInteger(oi) && oi >= 0 && oi < question.options.length,
    ) &&
    typeof a.text === 'string' &&
    typeof a.skipped === 'boolean'
  );
}

/**
 * Load and validate the draft stored under `key` for the given question set.
 * Any failure (corrupt JSON, version/shape/length mismatch, out-of-range
 * option index) discards the entry — the key is cleared and `null` returned —
 * so the wizard starts fresh instead of crashing on stale data. A stored
 * `idx` outside `[0, questions.length - 1]` is clamped, not discarded.
 */
export function loadWizardDraft(key: string, questions: Question[]): WizardDraft | null {
  const raw = safeLocalStorage.getItem(key);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeLocalStorage.removeItem(key);
    return null;
  }

  if (questions.length === 0 || !isStoredDraft(parsed, questions)) {
    safeLocalStorage.removeItem(key);
    return null;
  }

  return {
    idx: Math.min(Math.max(parsed.idx, 0), questions.length - 1),
    answers: parsed.answers.map((a) => ({ sel: [...a.sel], text: a.text, skipped: a.skipped })),
  };
}

function isStoredDraft(value: unknown, questions: Question[]): value is StoredWizardDraft {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<StoredWizardDraft>;
  return (
    s.version === DRAFT_VERSION &&
    typeof s.idx === 'number' &&
    Number.isInteger(s.idx) &&
    typeof s.savedAt === 'number' &&
    Array.isArray(s.answers) &&
    s.answers.length === questions.length &&
    s.answers.every((a, i) => isValidAnswer(a, questions[i]))
  );
}

/**
 * Prune stale entries in the namespace, then persist the draft under `key`.
 * Pruning first frees quota headroom, so a near-full localStorage cannot
 * fail the write while stale drafts still occupy the namespace
 * (`safeLocalStorage.setItem` swallows quota errors).
 */
export function saveWizardDraft(key: string, draft: WizardDraft): void {
  const stored: StoredWizardDraft = {
    version: DRAFT_VERSION,
    idx: draft.idx,
    answers: draft.answers,
    savedAt: Date.now(),
  };
  pruneStaleWizardDrafts(key);
  safeLocalStorage.setJSON(key, stored);
}

/** Delete the draft stored under `key` (answers sent or set dismissed). */
export function clearWizardDraft(key: string): void {
  safeLocalStorage.removeItem(key);
  safeLocalStorage.removeItem(wizardCollapsedKey(key));
}

interface StoredWizardCollapsed {
  version: number;
  collapsed: boolean;
  savedAt: number;
}

/**
 * Sibling record of the draft under `key` holding the wizard's collapsed
 * (Hide) state. Same namespace, so the 14-day prune covers it, and
 * `clearWizardDraft` deletes it with the draft.
 */
function wizardCollapsedKey(key: string): string {
  return `${key}${COLLAPSED_SUFFIX}`;
}

/**
 * Load the persisted collapsed state for the draft `key`. Returns `null`
 * (clearing any corrupt entry) when nothing valid is stored, so the caller
 * can fall back to its own default.
 */
export function loadWizardCollapsed(key: string): boolean | null {
  const collapsedKey = wizardCollapsedKey(key);
  const raw = safeLocalStorage.getItem(collapsedKey);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    safeLocalStorage.removeItem(collapsedKey);
    return null;
  }

  const s = parsed as Partial<StoredWizardCollapsed> | null;
  if (
    !s ||
    typeof s !== 'object' ||
    s.version !== DRAFT_VERSION ||
    typeof s.collapsed !== 'boolean' ||
    typeof s.savedAt !== 'number'
  ) {
    safeLocalStorage.removeItem(collapsedKey);
    return null;
  }

  return s.collapsed;
}

/**
 * Prune stale namespace entries, then persist the collapsed state for the
 * draft `key` — same ordering rationale as `saveWizardDraft`: pruning first
 * frees quota headroom so a near-full localStorage cannot fail the write
 * (`safeLocalStorage.setItem` swallows quota errors).
 */
export function saveWizardCollapsed(key: string, collapsed: boolean): void {
  const collapsedKey = wizardCollapsedKey(key);
  const stored: StoredWizardCollapsed = {
    version: DRAFT_VERSION,
    collapsed,
    savedAt: Date.now(),
  };
  pruneStaleWizardDrafts(collapsedKey);
  safeLocalStorage.setJSON(collapsedKey, stored);
}

/**
 * Resolve the collapsed state a newly pending question set starts in:
 * the persisted value for `key` when present; otherwise `true` when the
 * composer currently holds user input (auto-collapse — Hide semantics, so
 * the in-flight input is not replaced by the wizard); otherwise `false`.
 */
export function initialWizardCollapsed(key: string, hasComposerInput: boolean): boolean {
  return loadWizardCollapsed(key) ?? hasComposerInput;
}

/**
 * Drop namespace entries older than 14 days (by `savedAt`), so drafts of
 * sets resolved elsewhere or dismissed never accumulate. Unreadable entries
 * are dropped too; `skipKey` (the entry about to be written) is left alone.
 */
function pruneStaleWizardDrafts(skipKey: string): void {
  const cutoff = Date.now() - MAX_DRAFT_AGE_MS;
  for (const key of safeLocalStorage.keysWithPrefix(KEY_PREFIX)) {
    if (key === skipKey) continue;
    const stored = safeLocalStorage.getJSON<StoredWizardDraft>(key);
    if (!stored || typeof stored.savedAt !== 'number' || stored.savedAt < cutoff) {
      safeLocalStorage.removeItem(key);
    }
  }
}
