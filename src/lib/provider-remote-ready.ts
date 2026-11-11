/**
 * Remote-ready provider profiles: which configurations may run on remote
 * machines, and the settings that may only work on this backend.
 *
 * API key and Token profiles always work on remote machines, Different login
 * never does (its account folder is signed in here), and Advanced profiles
 * carry a manual toggle. Warnings come from the keys and the typed values;
 * saved values are masked, so only their keys are checked.
 */
import { m } from '$shared/paraglide/messages.js';
import type { EnvRow } from '$features/settings/profile-env-form';
import type { RemoteReason } from '$shared/provider-profiles';
import type { ProfileKind } from './provider-profile-kinds';

export type KindRemoteSupport = 'remote' | 'local' | 'choice';

export function kindRemoteSupport(kind: ProfileKind): KindRemoteSupport {
  if (kind === 'apiKey' || kind === 'token') return 'remote';
  if (kind === 'differentLogin') return 'local';
  return 'choice';
}

export type RemoteWarningReason =
  | 'file-path'
  | 'aws-profile'
  | 'api-key-helper'
  | 'local-url';

const ACCOUNT_FOLDER_KEYS = new Set(['CLAUDE_CONFIG_DIR', 'CODEX_HOME']);
const FILE_KEYS = new Set(['GOOGLE_APPLICATION_CREDENTIALS', 'AWS_SHARED_CREDENTIALS_FILE']);
const PATH_VALUE = /^(?:~|\.{1,2})?[/\\]|^[A-Za-z]:[/\\]/;
const LOCAL_URL = /(?:^|[/@:])(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?:[:/]|$)/i;

/** Reasons one env row triggers, from its key and (when typed) its value. Account folders: none. */
export function rowRemoteWarnings(key: string, value: string | undefined): RemoteWarningReason[] {
  const upper = key.trim().toUpperCase();
  if (!upper) return [];
  const reasons: RemoteWarningReason[] = [];
  if (ACCOUNT_FOLDER_KEYS.has(upper)) return [];
  if (FILE_KEYS.has(upper) || (value !== undefined && PATH_VALUE.test(value.trim())))
    reasons.push('file-path');
  if (upper === 'AWS_PROFILE') reasons.push('aws-profile');
  if (upper.includes('API_KEY_HELPER') || value?.includes('apiKeyHelper'))
    reasons.push('api-key-helper');
  if (value !== undefined && LOCAL_URL.test(value.trim())) reasons.push('local-url');
  return reasons;
}

/**
 * Warnings for an Advanced form, grouped by reason. A row that keeps a masked
 * saved value is checked by its key only. Account folders are not warnings:
 * see `accountFolderKeys`.
 */
export function remoteWarningsForRows(rows: readonly EnvRow[]): RemoteReason[] {
  const byReason = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key || row.mode === 'unset') continue;
    const keepsSaved = row.mode === 'value' && row.value === '' && row.saved !== undefined;
    const typed = row.mode === 'value' && !keepsSaved ? row.value : undefined;
    for (const reason of rowRemoteWarnings(key, typed)) {
      const keys = byReason.get(reason) ?? [];
      if (!keys.includes(key)) keys.push(key);
      byReason.set(reason, keys);
    }
  }
  return [...byReason].map(([reason, keys]) => ({ reason, keys }));
}

/**
 * The account-folder variables a form sets. Such a profile can't be marked
 * for remote machines (the daemon refuses with `remote-account-folder`).
 */
export function accountFolderKeys(rows: readonly EnvRow[]): string[] {
  return rows
    .filter((row) => row.mode !== 'unset' && ACCOUNT_FOLDER_KEYS.has(row.key.trim().toUpperCase()))
    .map((row) => row.key.trim());
}

/** One sentence per warning; unknown reasons get the generic wording. */
export function remoteWarningMessage(warning: RemoteReason): string {
  const keys = warning.keys.join(', ');
  switch (warning.reason) {
    case 'file-path':
      return m.settings_providerRemote_warningFilePath({ keys });
    case 'aws-profile':
      return m.settings_providerRemote_warningAwsProfile();
    case 'api-key-helper':
      return m.settings_providerRemote_warningApiKeyHelper();
    case 'local-url':
      return m.settings_providerRemote_warningLocalUrl({ keys });
    default:
      return m.settings_providerRemote_warningOther({ keys });
  }
}
