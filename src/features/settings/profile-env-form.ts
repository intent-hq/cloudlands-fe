/**
 * Pure form model for a named provider profile's environment overrides
 * (PROTOCOL §5.54). Saved values arrive masked and are never shown; an
 * untouched saved row is written as `keep` so its secret is not echoed.
 *
 * Validation is the daemon's job: this module only builds the write list and
 * maps the daemon's `fieldErrors` back onto the rows they name.
 */
import type {
  EnvEntryRead,
  EnvEntryWrite,
  ProviderProfileFieldError,
  ProviderProfileInUseReason,
} from '$shared/provider-profiles';
import { formatInteger } from '$lib/i18n/format';
import { m } from '$shared/paraglide/messages.js';

/** `value` sets a literal, `empty` sets `""`, `unset` removes an inherited variable. */
export type EnvRowMode = 'value' | 'empty' | 'unset';

export interface EnvRow {
  rowId: string;
  key: string;
  mode: EnvRowMode;
  /** Newly typed value; '' leaves a saved masked value unchanged. */
  value: string;
  /** The saved entry this row was loaded from (masked; no value). */
  saved?: { key: string; mode: EnvRowMode };
}

function readMode(entry: EnvEntryRead): EnvRowMode {
  if (entry.kind === 'unset') return 'unset';
  return entry.value === '' ? 'empty' : 'value';
}

export function rowsFromSaved(env: EnvEntryRead[], newId: () => string): EnvRow[] {
  return env.map((entry) => {
    const mode = readMode(entry);
    return { rowId: newId(), key: entry.key, mode, value: '', saved: { key: entry.key, mode } };
  });
}

export function newRow(newId: () => string): EnvRow {
  return { rowId: newId(), key: '', mode: 'value', value: '' };
}

/** True when the row still holds a saved entry unchanged (so it is written as `keep`). */
function isRowUnchanged(row: EnvRow): boolean {
  return Boolean(
    row.saved && row.saved.key === row.key.trim() && row.saved.mode === row.mode && !row.value,
  );
}

/** True when a saved masked value is kept for this row. */
export function keepsSavedValue(row: EnvRow): boolean {
  return Boolean(row.saved?.mode === 'value' && row.saved.key === row.key.trim() && !row.value);
}

export type EnvBuildResult =
  { ok: true; env: EnvEntryWrite[] } | { ok: false; rowErrors: Record<string, string> };

/** A new row the user never filled in (the dialog's starter row); it writes nothing. */
function isBlankNewRow(row: EnvRow): boolean {
  return !row.saved && !row.key.trim() && row.mode === 'value' && !row.value;
}

/**
 * Build the complete `env` write list in row order, skipping untouched blank
 * new rows. Daemon `env[i]` errors index this list, so map them with
 * {@link writtenRows}.
 */
export function buildEnvWrites(rows: EnvRow[]): EnvBuildResult {
  const env: EnvEntryWrite[] = [];
  const rowErrors: Record<string, string> = {};
  for (const row of writtenRows(rows)) {
    const key = row.key.trim();
    if (isRowUnchanged(row)) env.push({ key, kind: 'keep' });
    else if (row.mode === 'unset') env.push({ key, kind: 'unset' });
    else if (row.mode === 'empty') env.push({ key, kind: 'set', value: '' });
    else if (row.value) env.push({ key, kind: 'set', value: row.value });
    else if (keepsSavedValue(row)) env.push({ key, kind: 'keep' });
    else rowErrors[`${row.rowId}.value`] = m.settings_providerProfiles_valueRequired_error();
  }
  return Object.keys(rowErrors).length > 0 ? { ok: false, rowErrors } : { ok: true, env };
}

/** The rows that produce an `env` entry, in write order. */
export function writtenRows(rows: EnvRow[]): EnvRow[] {
  return rows.filter((row) => !isBlankNewRow(row));
}

/** True when an edit leaves every saved entry as it was (rename-only update). */
export function isEnvUnchanged(rows: EnvRow[], saved: EnvEntryRead[]): boolean {
  const written = writtenRows(rows);
  return (
    written.length === saved.length &&
    written.every((row, index) => isRowUnchanged(row) && row.saved?.key === saved[index]?.key)
  );
}

function fieldErrorMessage(error: ProviderProfileFieldError, providerName: string): string {
  switch (error.code) {
    case 'name-blank':
      return m.settings_providerProfiles_nameBlank_error();
    case 'name-invalid':
      return m.settings_providerProfiles_nameInvalid_error();
    case 'name-duplicate':
      return m.settings_providerProfiles_nameDuplicate_error({ provider: providerName });
    case 'name-reserved':
      return m.settings_providerProfiles_nameReserved_error();
    case 'profile-limit':
      return m.settings_providerProfiles_profileLimit_error();
    case 'env-limit':
      return m.settings_providerProfiles_envLimit_error();
    case 'env-key-invalid':
      return m.settings_providerProfiles_keyInvalid_error();
    case 'env-key-duplicate':
      return m.settings_providerProfiles_keyDuplicate_error();
    case 'env-value-invalid':
      return m.settings_providerProfiles_valueInvalid_error();
    case 'env-value-placeholder':
    case 'env-keep-missing':
      return m.settings_providerProfiles_valueRequired_error();
    case 'base-provider-unsupported':
      return m.settings_providerProfiles_unsupported_error();
    default:
      // Reason-specific daemon copy (for example why a reserved key is Intent-owned).
      return error.message;
  }
}

const ENV_FIELD = /^env\[(\d+)\]\.(key|value|kind)$/;

/**
 * Map daemon `fieldErrors` onto form slots: `name`, `env` (list-level), or
 * `<rowId>.key|value` for the row at the reported index. Unknown fields fall
 * into `general` so no failure is hidden.
 */
export function mapFieldErrors(
  fieldErrors: ProviderProfileFieldError[],
  rows: EnvRow[],
  providerName: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const add = (slot: string, message: string) => {
    errors[slot] = errors[slot] ? `${errors[slot]} ${message}` : message;
  };
  for (const error of fieldErrors) {
    const message = fieldErrorMessage(error, providerName);
    const match = ENV_FIELD.exec(error.field);
    const row = match ? rows[Number(match[1])] : undefined;
    if (row && match) add(`${row.rowId}.${match[2] === 'kind' ? 'value' : match[2]}`, message);
    else if (error.field === 'name') add('name', message);
    else if (error.field === 'env' || error.field === 'baseProviderId') add('env', message);
    else add('general', message);
  }
  return errors;
}

/** Named reasons a daemon refused deletion (`provider-profile-in-use`). */
export function describeInUse(inUse: ProviderProfileInUseReason[]): string {
  return inUse
    .map((reason) => {
      switch (reason.kind) {
        case 'defaultProvider':
          return m.settings_providerProfiles_inUseDefault_label();
        case 'specialistProvider':
          return m.settings_providerProfiles_inUseSpecialist_label({
            name: reason.specialistId,
            source: reason.source,
          });
        case 'specialistModelOption':
          return m.settings_providerProfiles_inUseSpecialistOption_label({
            name: reason.specialistId,
            source: reason.source,
            position: formatInteger(reason.index + 1),
          });
      }
    })
    .join('\n');
}

/**
 * Restart guidance for saved env edits. Only a client that spawned its own
 * daemon names Intent; otherwise intentd on the provider host. A frontend
 * reconnect is never presented as applying the edit.
 */
export function restartGuidance(appOwned: boolean): string {
  return appOwned
    ? m.settings_providerProfiles_restartLocal_description()
    : m.settings_providerProfiles_restartRemote_description();
}

export function runningProcessesNotice(count: number, appOwned: boolean): string {
  const running =
    count > 1
      ? m.settings_providerProfiles_earlierSettings_many({ count: formatInteger(count) })
      : m.settings_providerProfiles_earlierSettings_one();
  return `${running} ${
    appOwned
      ? m.settings_providerProfiles_restartLocalShort_label()
      : m.settings_providerProfiles_restartRemoteShort_label()
  }`;
}
