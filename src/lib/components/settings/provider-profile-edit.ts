/**
 * Pure helpers for editing a Claude Code / Codex profile on its kind's screen
 * (PROTOCOL §5.54): what the saved env says about the screen, and how unsaved
 * screen edits carry into the Advanced rows on Switch to Advanced.
 */
import type { EnvEntryRead, EnvEntryWrite } from '$shared/provider-profiles';
import { newRow, rowsFromSaved, type EnvRow } from '$features/settings/profile-env-form';
import {
  savedFolderPath,
  secretKeyFor,
  type ProfileProvider,
  type SpecializedProfileKind,
} from '$lib/provider-profile-kinds';
import type { BaseUrlAction } from './profile-kinds/profile-kind-mock';

const BASE_URL_KEY = 'ANTHROPIC_BASE_URL';

const sameKey = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

function hasSet(env: readonly EnvEntryRead[], key: string): boolean {
  return env.some((entry) => entry.kind === 'set' && sameKey(entry.key, key));
}

/** What a saved profile shows on its kind's edit screen. */
export function editScreenFacts(
  provider: ProfileProvider,
  kind: SpecializedProfileKind | 'advanced',
  env: readonly EnvEntryRead[],
): { secretSaved: boolean; baseUrlSaved: boolean; folder: string } {
  return {
    secretSaved:
      kind === 'apiKey' || kind === 'token' ? hasSet(env, secretKeyFor(kind, provider)) : false,
    baseUrlSaved: kind === 'apiKey' && hasSet(env, BASE_URL_KEY),
    folder: kind === 'differentLogin' ? (savedFolderPath(provider, env) ?? '') : '',
  };
}

/**
 * True when a specialized screen's update env would change what is saved: a
 * new value, a removed entry, or an unset that was missing (re-added on Save).
 */
export function editEnvChanges(
  saved: readonly EnvEntryRead[],
  env: readonly EnvEntryWrite[],
): boolean {
  if (env.some((entry) => entry.kind === 'set')) return true;
  const written = (key: string) => env.some((entry) => sameKey(entry.key, key));
  if (saved.some((entry) => !written(entry.key))) return true;
  return env.some(
    (entry) =>
      entry.kind === 'unset' &&
      !saved.some((item) => item.kind === 'unset' && sameKey(item.key, entry.key)),
  );
}

/** Unsaved edits on an API key / Token screen. */
export interface SecretScreenEdits {
  /** The typed key/token; only used while replacing (or with none saved). */
  secret: string;
  replacing: boolean;
  secretSaved: boolean;
  baseUrl: string;
  baseUrlSaved: boolean;
  baseUrlAction: BaseUrlAction;
}

/** Point a row at a newly typed value, or append one for the key. */
function withTypedValue(rows: EnvRow[], key: string, value: string, newId: () => string): EnvRow[] {
  const index = rows.findIndex((row) => sameKey(row.key, key));
  if (index >= 0) {
    return rows.map((row, i) => (i === index ? { ...row, mode: 'value', value } : row));
  }
  return [...rows, { ...newRow(newId), key, value }];
}

/**
 * The Advanced rows for Switch to Advanced: the saved env, with a key/token or
 * Custom endpoint typed on the screen (not saved yet) carried into its row and
 * a Custom endpoint marked for removal dropped. Nothing typed is discarded.
 */
export function advancedRowsFromEdit(
  provider: ProfileProvider,
  kind: SpecializedProfileKind,
  savedEnv: EnvEntryRead[],
  edits: SecretScreenEdits | undefined,
  newId: () => string,
): EnvRow[] {
  let rows = rowsFromSaved(savedEnv, newId);
  if (!edits || (kind !== 'apiKey' && kind !== 'token')) return rows;
  const secret = edits.secret.trim();
  if (secret && (edits.replacing || !edits.secretSaved)) {
    rows = withTypedValue(rows, secretKeyFor(kind, provider), secret, newId);
  }
  if (kind === 'apiKey') {
    const baseUrl = edits.baseUrl.trim();
    if (edits.baseUrlSaved && edits.baseUrlAction === 'remove') {
      rows = rows.filter((row) => !sameKey(row.key, BASE_URL_KEY));
    } else if (baseUrl && (edits.baseUrlAction === 'replace' || !edits.baseUrlSaved)) {
      rows = withTypedValue(rows, BASE_URL_KEY, baseUrl, newId);
    }
  }
  return rows;
}
