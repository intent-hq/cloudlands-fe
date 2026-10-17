import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import type { EnvEntryRead } from '$shared/provider-profiles';
import {
  buildEnvWrites,
  describeInUse,
  isEnvUnchanged,
  mapFieldErrors,
  newRow,
  restartGuidance,
  rowsFromSaved,
  runningProcessesNotice,
} from './profile-env-form';

let seq = 0;
const id = () => `row-${++seq}`;

const SAVED: EnvEntryRead[] = [
  { key: 'CODEX_HOME', kind: 'set', value: '********' },
  { key: 'OPENAI_BASE_URL', kind: 'set', value: '' },
  { key: 'OPENAI_API_KEY', kind: 'unset' },
];

describe('profile env form', () => {
  it('loads masked saved entries without exposing values and keeps them untouched', () => {
    const rows = rowsFromSaved(SAVED, id);
    expect(rows.map((row) => [row.key, row.mode, row.value])).toEqual([
      ['CODEX_HOME', 'value', ''],
      ['OPENAI_BASE_URL', 'empty', ''],
      ['OPENAI_API_KEY', 'unset', ''],
    ]);
    expect(buildEnvWrites(rows)).toEqual({
      ok: true,
      env: [
        { key: 'CODEX_HOME', kind: 'keep' },
        { key: 'OPENAI_BASE_URL', kind: 'keep' },
        { key: 'OPENAI_API_KEY', kind: 'keep' },
      ],
    });
    expect(isEnvUnchanged(rows, SAVED)).toBe(true);
    // The masked placeholder is never written back as a literal value.
    expect(JSON.stringify(buildEnvWrites(rows))).not.toContain('********');
  });

  it('distinguishes a literal value, an empty string and an explicit unset', () => {
    const rows = [newRow(id), newRow(id), newRow(id)];
    rows[0] = { ...rows[0], key: ' ANTHROPIC_BASE_URL ', value: 'https://proxy.example' };
    rows[1] = { ...rows[1], key: 'EMPTY_ONE', mode: 'empty' };
    rows[2] = { ...rows[2], key: 'ANTHROPIC_API_KEY', mode: 'unset', value: 'ignored' };
    expect(buildEnvWrites(rows)).toEqual({
      ok: true,
      env: [
        { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: 'https://proxy.example' },
        { key: 'EMPTY_ONE', kind: 'set', value: '' },
        { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
      ],
    });
  });

  it('replaces a saved value only when a new one is typed, and switching mode writes the new kind', () => {
    const rows = rowsFromSaved(SAVED, id);
    rows[0] = { ...rows[0], value: 'new-secret' };
    rows[1] = { ...rows[1], mode: 'unset' };
    const result = buildEnvWrites(rows);
    expect(result).toEqual({
      ok: true,
      env: [
        { key: 'CODEX_HOME', kind: 'set', value: 'new-secret' },
        { key: 'OPENAI_BASE_URL', kind: 'unset' },
        { key: 'OPENAI_API_KEY', kind: 'keep' },
      ],
    });
    expect(isEnvUnchanged(rows, SAVED)).toBe(false);
  });

  it('removing a row drops it from the complete list so it inherits again', () => {
    const rows = rowsFromSaved(SAVED, id).slice(1);
    expect(isEnvUnchanged(rows, SAVED)).toBe(false);
    const result = buildEnvWrites(rows);
    expect(result.ok && result.env.map((entry) => entry.key)).toEqual([
      'OPENAI_BASE_URL',
      'OPENAI_API_KEY',
    ]);
  });

  it('requires a value for a new key or a renamed masked key instead of sending keep', () => {
    const fresh = { ...newRow(id), key: 'NEW_KEY' };
    const renamed = { ...rowsFromSaved(SAVED, id)[0], key: 'CODEX_HOME_2' };
    const result = buildEnvWrites([fresh, renamed]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.rowErrors).sort()).toEqual(
        [`${fresh.rowId}.value`, `${renamed.rowId}.value`].sort(),
      );
    }
  });

  it('maps daemon field errors onto the rows they index and keeps unknown fields visible', () => {
    const rows = rowsFromSaved(SAVED, id);
    const errors = mapFieldErrors(
      [
        { field: 'name', code: 'name-duplicate', message: 'dup' },
        { field: 'env[2].key', code: 'env-key-reserved', message: 'PATH is Intent-owned' },
        { field: 'env[0].kind', code: 'env-keep-missing', message: 'missing' },
        { field: 'env', code: 'env-limit', message: 'too many' },
        { field: 'mystery', code: 'x', message: 'daemon says no' },
      ],
      rows,
      'Codex',
    );
    expect(Object.keys(errors).sort()).toEqual(
      ['name', `${rows[2].rowId}.key`, `${rows[0].rowId}.value`, 'env', 'general'].sort(),
    );
    // Reserved-key copy is reason-specific and comes from the daemon.
    expect(errors[`${rows[2].rowId}.key`]).toBe('PATH is Intent-owned');
    expect(errors.general).toBe('daemon says no');
  });

  it('names Intent only for an app-owned daemon and intentd otherwise', () => {
    expect(restartGuidance(true)).toBe(m.settings_providerProfiles_restartLocal_description());
    expect(restartGuidance(false)).toBe(m.settings_providerProfiles_restartRemote_description());
    expect(runningProcessesNotice(1, true)).toContain(
      m.settings_providerProfiles_restartLocalShort_label(),
    );
    expect(runningProcessesNotice(3, false)).toContain(
      m.settings_providerProfiles_restartRemoteShort_label(),
    );
  });

  it('describes each daemon in-use reason on its own line', () => {
    const text = describeInUse([
      { kind: 'defaultProvider' },
      { kind: 'specialistProvider', specialistId: 'reviewer', source: 'user' },
      { kind: 'specialistModelOption', specialistId: 'planner', source: 'project', index: 0 },
    ]);
    const lines = text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('reviewer');
    expect(lines[2]).toContain('planner');
  });
});
