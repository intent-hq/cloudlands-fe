import { describe, expect, it } from 'vitest';
import type { EnvEntryRead, EnvEntryWrite } from '$shared/provider-profiles';
import { advancedRowsFromEdit, editEnvChanges, editScreenFacts } from './provider-profile-edit';

let n = 0;
const newId = () => `r${++n}`;

const CLAUDE_KEY: EnvEntryRead[] = [
  { key: 'ANTHROPIC_API_KEY', kind: 'set', value: '********' },
  { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: '********' },
  { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
];

const noEdits = {
  secret: '',
  replacing: false,
  secretSaved: true,
  baseUrl: '',
  baseUrlSaved: true,
  baseUrlAction: 'keep' as const,
};

describe('editScreenFacts', () => {
  it('reads saved secrets, Custom endpoint and folder', () => {
    expect(editScreenFacts('claude', 'apiKey', CLAUDE_KEY)).toEqual({
      secretSaved: true,
      baseUrlSaved: true,
      folder: '',
    });
    expect(
      editScreenFacts('codex', 'differentLogin', [
        { key: 'codex_home', kind: 'set', value: '~/.codex-work' },
      ]),
    ).toEqual({ secretSaved: false, baseUrlSaved: false, folder: '~/.codex-work' });
    expect(
      editScreenFacts('codex', 'token', [
        { key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: '********' },
      ]).secretSaved,
    ).toBe(true);
  });
});

describe('advancedRowsFromEdit', () => {
  it('without edits shows the saved env as is', () => {
    const rows = advancedRowsFromEdit('claude', 'apiKey', CLAUDE_KEY, noEdits, newId);
    expect(rows.map((row) => [row.key, row.mode, row.value])).toEqual([
      ['ANTHROPIC_API_KEY', 'value', ''],
      ['ANTHROPIC_BASE_URL', 'value', ''],
      ['ANTHROPIC_AUTH_TOKEN', 'unset', ''],
    ]);
  });

  it('carries a typed replacement key and Base URL into their rows', () => {
    const rows = advancedRowsFromEdit(
      'claude',
      'apiKey',
      CLAUDE_KEY,
      {
        ...noEdits,
        secret: ' sk-new ',
        replacing: true,
        baseUrl: 'https://gw.example',
        baseUrlAction: 'replace',
      },
      newId,
    );
    expect(rows.find((row) => row.key === 'ANTHROPIC_API_KEY')?.value).toBe('sk-new');
    expect(rows.find((row) => row.key === 'ANTHROPIC_BASE_URL')?.value).toBe('https://gw.example');
    expect(rows).toHaveLength(3);
  });

  it('adds a row for a new Base URL and drops one marked for removal', () => {
    const noBaseUrl = CLAUDE_KEY.filter((entry) => entry.key !== 'ANTHROPIC_BASE_URL');
    const added = advancedRowsFromEdit(
      'claude',
      'apiKey',
      noBaseUrl,
      { ...noEdits, baseUrlSaved: false, baseUrl: 'https://gw.example' },
      newId,
    );
    expect(added.at(-1)).toMatchObject({ key: 'ANTHROPIC_BASE_URL', value: 'https://gw.example' });
    const removed = advancedRowsFromEdit(
      'claude',
      'apiKey',
      CLAUDE_KEY,
      { ...noEdits, baseUrlAction: 'remove' },
      newId,
    );
    expect(removed.map((row) => row.key)).not.toContain('ANTHROPIC_BASE_URL');
  });

  it('ignores a typed token when Replace was cancelled', () => {
    const rows = advancedRowsFromEdit(
      'codex',
      'token',
      [{ key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: '********' }],
      { ...noEdits, secret: 'a.b.c', replacing: false },
      newId,
    );
    expect(rows[0].value).toBe('');
  });
});

describe('editEnvChanges', () => {
  const saved: EnvEntryRead[] = [
    { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/.claude-work' },
    { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
  ];
  const keepAll: EnvEntryWrite[] = [
    { key: 'CLAUDE_CONFIG_DIR', kind: 'keep' },
    { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
  ];
  it('is false when every entry is kept', () => {
    expect(editEnvChanges(saved, keepAll)).toBe(false);
  });
  it('is true for a re-added unset, a new value or a removed entry', () => {
    expect(
      editEnvChanges(saved, [...keepAll, { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' }]),
    ).toBe(true);
    expect(
      editEnvChanges(saved, [{ key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: 'x' }, keepAll[1]]),
    ).toBe(true);
    expect(editEnvChanges(saved, [keepAll[0]])).toBe(true);
  });
});
