import { describe, expect, it } from 'vitest';
import type { EnvEntryRead } from '$shared/provider-profiles';
import {
  MASKED_ENV_VALUE,
  baseProviderIdFor,
  buildCreatePayload,
  buildUpdateEnv,
  detectProfileKind,
  folderVariableFor,
  isJwtShaped,
  loginCommand,
  pickUnusedFolder,
  profileFoldersParent,
  profileProviderFromBaseId,
  randomSuffix,
  savedFolderPath,
  slugifyProfileName,
  type ProfileKind,
  type ProfileProvider,
} from './provider-profile-kinds';

const set = (key: string, value = MASKED_ENV_VALUE): EnvEntryRead => ({ key, kind: 'set', value });
const unset = (key: string): EnvEntryRead => ({ key, kind: 'unset' });

/** An rng that yields the given alphabet indexes in order, then repeats. */
function seededRng(indexes: number[]): () => number {
  let i = 0;
  return () => (indexes[i++ % indexes.length] + 0.5) / 36;
}

const CLAUDE_LOGIN_UNSETS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
];
const CODEX_LOGIN_UNSETS = ['CODEX_ACCESS_TOKEN', 'CODEX_API_KEY', 'OPENAI_API_KEY'];

describe('detectProfileKind', () => {
  const rows: [string, ProfileProvider, EnvEntryRead[], ProfileKind][] = [
    [
      'claude different login',
      'claude',
      [set('CLAUDE_CONFIG_DIR', '~/intent/profiles/claude/work-k3f9')],
      'differentLogin',
    ],
    [
      'claude hand-made folder',
      'claude',
      [set('CLAUDE_CONFIG_DIR', '~/.claude-work')],
      'differentLogin',
    ],
    [
      'claude different login + all unsets',
      'claude',
      [set('CLAUDE_CONFIG_DIR', '~/x'), ...CLAUDE_LOGIN_UNSETS.map(unset)],
      'differentLogin',
    ],
    ['claude api key', 'claude', [set('ANTHROPIC_API_KEY')], 'apiKey'],
    [
      'claude api key + base url',
      'claude',
      [set('ANTHROPIC_API_KEY'), set('ANTHROPIC_BASE_URL')],
      'apiKey',
    ],
    [
      'claude api key + unsets',
      'claude',
      [set('ANTHROPIC_API_KEY'), unset('ANTHROPIC_AUTH_TOKEN'), unset('CLAUDE_CODE_OAUTH_TOKEN')],
      'apiKey',
    ],
    [
      'claude token',
      'claude',
      [set('CLAUDE_CODE_OAUTH_TOKEN'), unset('ANTHROPIC_API_KEY'), unset('ANTHROPIC_AUTH_TOKEN')],
      'token',
    ],
    ['claude no variables', 'claude', [], 'advanced'],
    ['claude base url only', 'claude', [set('ANTHROPIC_BASE_URL')], 'advanced'],
    [
      'codex different login',
      'codex',
      [set('CODEX_HOME', '~/intent/profiles/codex/work-k3f9'), ...CODEX_LOGIN_UNSETS.map(unset)],
      'differentLogin',
    ],
    [
      'codex token',
      'codex',
      [set('CODEX_ACCESS_TOKEN'), unset('CODEX_API_KEY'), unset('OPENAI_API_KEY')],
      'token',
    ],
    ['codex OPENAI_API_KEY set', 'codex', [set('OPENAI_API_KEY')], 'advanced'],
    ['codex no variables', 'codex', [], 'advanced'],
  ];
  it.each(rows)('%s', (_label, provider, env, kind) => {
    expect(detectProfileKind(provider, env)).toBe(kind);
  });

  it('opens Advanced for an extra set key', () => {
    expect(detectProfileKind('claude', [set('CLAUDE_CONFIG_DIR', '~/x'), set('HTTPS_PROXY')])).toBe(
      'advanced',
    );
    expect(detectProfileKind('codex', [set('CODEX_ACCESS_TOKEN'), set('CODEX_HOME', '~/x')])).toBe(
      'advanced',
    );
  });

  it('opens Advanced for an unset outside the kind list', () => {
    expect(
      detectProfileKind('claude', [set('ANTHROPIC_API_KEY'), unset('ANTHROPIC_API_KEY_2')]),
    ).toBe('advanced');
    // ANTHROPIC_API_KEY is a Token unset but not an API-key unset.
    expect(
      detectProfileKind('claude', [
        set('CLAUDE_CODE_OAUTH_TOKEN'),
        unset('CLAUDE_CODE_OAUTH_TOKEN'),
      ]),
    ).toBe('advanced');
    expect(
      detectProfileKind('codex', [set('CODEX_ACCESS_TOKEN'), unset('CODEX_ACCESS_TOKEN')]),
    ).toBe('advanced');
  });

  it('opens Advanced for unsets alone', () => {
    expect(detectProfileKind('claude', CLAUDE_LOGIN_UNSETS.map(unset))).toBe('advanced');
  });

  it('compares keys ignoring case', () => {
    expect(
      detectProfileKind('claude', [set('claude_config_dir', '~/x'), unset('Anthropic_Api_Key')]),
    ).toBe('differentLogin');
    expect(detectProfileKind('codex', [set('codex_access_token'), unset('openai_api_key')])).toBe(
      'token',
    );
  });

  it('opens Advanced for a masked or empty folder path (older daemon)', () => {
    expect(detectProfileKind('claude', [set('CLAUDE_CONFIG_DIR', MASKED_ENV_VALUE)])).toBe(
      'advanced',
    );
    expect(
      detectProfileKind('codex', [
        set('CODEX_HOME', MASKED_ENV_VALUE),
        ...CODEX_LOGIN_UNSETS.map(unset),
      ]),
    ).toBe('advanced');
    expect(detectProfileKind('claude', [set('CLAUDE_CONFIG_DIR', '')])).toBe('advanced');
  });

  it('opens Advanced for a key saved twice in different case', () => {
    expect(detectProfileKind('claude', [set('ANTHROPIC_API_KEY'), set('anthropic_api_key')])).toBe(
      'advanced',
    );
  });

  it('does not treat the other provider’s keys as a match', () => {
    expect(detectProfileKind('codex', [set('CLAUDE_CONFIG_DIR', '~/x')])).toBe('advanced');
    expect(detectProfileKind('claude', [set('CODEX_HOME', '~/x')])).toBe('advanced');
  });
});

describe('savedFolderPath', () => {
  it('reads the folder variable ignoring case', () => {
    expect(savedFolderPath('codex', [set('codex_home', '~/c')])).toBe('~/c');
    expect(savedFolderPath('claude', [set('ANTHROPIC_API_KEY')])).toBeUndefined();
  });
});

describe('slugifyProfileName', () => {
  it.each([
    ['Work account', 'work-account'],
    ['Équipe', 'equipe'],
    ['Crème brûlée & Co.', 'creme-brulee-co'],
    ['  --Hello__World--  ', 'hello-world'],
    ['ABC123', 'abc123'],
    ['', 'profile'],
    ['日本語', 'profile'],
    ['---', 'profile'],
  ])('%j → %j', (name, slug) => {
    expect(slugifyProfileName(name)).toBe(slug);
  });

  it('cuts to 32 characters and trims a dash left by the cut', () => {
    // 31 letters, a space, then more: the cut lands right after the dash.
    const name = `${'a'.repeat(31)} bcd`;
    expect(slugifyProfileName(name)).toBe('a'.repeat(31));
    expect(slugifyProfileName('x'.repeat(40))).toBe('x'.repeat(32));
  });
});

describe('randomSuffix', () => {
  it('returns 4 lowercase letters/digits from the rng', () => {
    expect(randomSuffix(seededRng([10, 29, 31, 25]))).toBe('k35z');
    expect(randomSuffix(() => 0)).toBe('aaaa');
    expect(randomSuffix(() => 0.9999999)).toBe('9999');
  });

  it('uses a secure default source', () => {
    for (let i = 0; i < 20; i++) expect(randomSuffix()).toMatch(/^[a-z0-9]{4}$/);
  });
});

describe('pickUnusedFolder', () => {
  it('builds the ~/ path from the slug and suffix', () => {
    expect(pickUnusedFolder('claude', 'Work account', [], seededRng([10, 29, 31, 25]))).toBe(
      '~/intent/profiles/claude/work-account-k35z',
    );
    expect(pickUnusedFolder('codex', '', [], () => 0)).toBe('~/intent/profiles/codex/profile-aaaa');
  });

  it('retries the suffix while the folder name is taken', () => {
    // First suffix "aaaa" collides (seeded folder), second "bbbb" is free.
    const rng = seededRng([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(pickUnusedFolder('claude', 'Work', ['work-aaaa', 'other'], rng)).toBe(
      '~/intent/profiles/claude/work-bbbb',
    );
  });

  it('treats existing names case-insensitively', () => {
    const rng = seededRng([0, 0, 0, 0, 1, 1, 1, 1]);
    expect(pickUnusedFolder('codex', 'Work', ['WORK-AAAA'], rng)).toBe(
      '~/intent/profiles/codex/work-bbbb',
    );
  });

  it('throws instead of looping forever when every suffix collides', () => {
    expect(() => pickUnusedFolder('claude', 'Work', ['work-aaaa'], () => 0)).toThrow(/No unused/);
  });
});

describe('buildCreatePayload', () => {
  it('Claude Different login: folder + three unsets', () => {
    expect(
      buildCreatePayload('differentLogin', 'claude', {
        name: ' Work ',
        backup: true,
        folder: '~/intent/profiles/claude/work-k3f9',
      }),
    ).toEqual({
      baseProviderId: 'claude-code',
      name: 'Work',
      backup: true,
      env: [
        { key: 'CLAUDE_CONFIG_DIR', kind: 'set', value: '~/intent/profiles/claude/work-k3f9' },
        { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
        { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
        { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
      ],
    });
  });

  it('Claude API key without a Custom endpoint', () => {
    expect(
      buildCreatePayload('apiKey', 'claude', { name: 'Key', apiKey: ' sk-ant-1 ', baseUrl: '  ' }),
    ).toEqual({
      baseProviderId: 'claude-code',
      name: 'Key',
      backup: false,
      env: [
        { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk-ant-1' },
        { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
        { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
      ],
    });
  });

  it('Claude API key with a Custom endpoint', () => {
    expect(
      buildCreatePayload('apiKey', 'claude', {
        name: 'Key',
        apiKey: 'sk',
        baseUrl: 'https://gw.example',
      }).env,
    ).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'set', value: 'sk' },
      { key: 'ANTHROPIC_BASE_URL', kind: 'set', value: 'https://gw.example' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);
  });

  it('Claude Token', () => {
    expect(buildCreatePayload('token', 'claude', { name: 'T', token: 'oat' }).env).toEqual([
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'set', value: 'oat' },
      { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
    ]);
  });

  const codexFolderEnv = [
    { key: 'CODEX_HOME', kind: 'set', value: '~/intent/profiles/codex/w-aaaa' },
    { key: 'CODEX_ACCESS_TOKEN', kind: 'unset' },
    { key: 'CODEX_API_KEY', kind: 'unset' },
    { key: 'OPENAI_API_KEY', kind: 'unset' },
  ];

  it('Codex Different login: CODEX_HOME + three unsets', () => {
    const payload = buildCreatePayload('differentLogin', 'codex', {
      name: 'W',
      folder: '~/intent/profiles/codex/w-aaaa',
    });
    expect(payload.baseProviderId).toBe('codex');
    expect(payload.env).toEqual(codexFolderEnv);
  });

  it('has no Codex API-key kind', () => {
    expect(() =>
      buildCreatePayload('apiKey', 'codex', {
        name: 'W',
        folder: '~/intent/profiles/codex/w-aaaa',
        apiKey: 'sk',
      }),
    ).toThrow(/No apiKey kind for codex/);
  });

  it('Codex Token', () => {
    expect(buildCreatePayload('token', 'codex', { name: 'T', token: 'a.b.c' }).env).toEqual([
      { key: 'CODEX_ACCESS_TOKEN', kind: 'set', value: 'a.b.c' },
      { key: 'CODEX_API_KEY', kind: 'unset' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ]);
  });

  it('every created payload detects back as its own kind', () => {
    const cases: [ProfileProvider, 'differentLogin' | 'apiKey' | 'token'][] = [
      ['claude', 'differentLogin'],
      ['claude', 'apiKey'],
      ['claude', 'token'],
      ['codex', 'differentLogin'],
      ['codex', 'token'],
    ];
    for (const [provider, kind] of cases) {
      const env = buildCreatePayload(kind, provider, {
        name: 'n',
        folder: '~/f',
        apiKey: 'k',
        baseUrl: 'https://u',
        token: 't',
      }).env as EnvEntryRead[];
      expect(detectProfileKind(provider, env)).toBe(kind);
    }
  });

  it('throws for a missing required value', () => {
    expect(() => buildCreatePayload('apiKey', 'claude', { name: 'K', apiKey: ' ' })).toThrow(
      /API key/,
    );
    expect(() => buildCreatePayload('token', 'codex', { name: 'T' })).toThrow(/token/);
    expect(() => buildCreatePayload('differentLogin', 'claude', { name: 'D' })).toThrow(/folder/);
  });
});

describe('buildUpdateEnv', () => {
  it('keeps the folder and re-adds missing unsets', () => {
    const saved = [set('CLAUDE_CONFIG_DIR', '~/.claude-work'), unset('ANTHROPIC_API_KEY')];
    expect(buildUpdateEnv('differentLogin', 'claude', saved)).toEqual([
      { key: 'CLAUDE_CONFIG_DIR', kind: 'keep' },
      { key: 'ANTHROPIC_API_KEY', kind: 'unset' },
      { key: 'ANTHROPIC_AUTH_TOKEN', kind: 'unset' },
      { key: 'CLAUDE_CODE_OAUTH_TOKEN', kind: 'unset' },
    ]);
  });

  it('sends keep for a saved secret that is not replaced', () => {
    expect(buildUpdateEnv('token', 'codex', [set('CODEX_ACCESS_TOKEN')])).toEqual([
      { key: 'CODEX_ACCESS_TOKEN', kind: 'keep' },
      { key: 'CODEX_API_KEY', kind: 'unset' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ]);
  });

  it('sets a replaced secret', () => {
    expect(
      buildUpdateEnv('apiKey', 'claude', [set('ANTHROPIC_API_KEY')], { apiKey: ' new ' })[0],
    ).toEqual({
      key: 'ANTHROPIC_API_KEY',
      kind: 'set',
      value: 'new',
    });
  });

  it('keeps, replaces or removes the Custom endpoint', () => {
    const saved = [set('ANTHROPIC_API_KEY'), set('ANTHROPIC_BASE_URL')];
    expect(buildUpdateEnv('apiKey', 'claude', saved).slice(0, 2)).toEqual([
      { key: 'ANTHROPIC_API_KEY', kind: 'keep' },
      { key: 'ANTHROPIC_BASE_URL', kind: 'keep' },
    ]);
    expect(buildUpdateEnv('apiKey', 'claude', saved, { baseUrl: 'https://new' })[1]).toEqual({
      key: 'ANTHROPIC_BASE_URL',
      kind: 'set',
      value: 'https://new',
    });
    const removed = buildUpdateEnv('apiKey', 'claude', saved, { baseUrl: null });
    expect(removed.some((entry) => entry.key === 'ANTHROPIC_BASE_URL')).toBe(false);
    const added = buildUpdateEnv('apiKey', 'claude', [set('ANTHROPIC_API_KEY')], {
      baseUrl: 'https://u',
    });
    expect(added[1]).toEqual({ key: 'ANTHROPIC_BASE_URL', kind: 'set', value: 'https://u' });
  });

  it('keeps saved key spelling so keep names the saved entry', () => {
    const saved = [set('codex_home', '~/c'), unset('openai_api_key')];
    expect(buildUpdateEnv('differentLogin', 'codex', saved)).toEqual([
      { key: 'codex_home', kind: 'keep' },
      { key: 'CODEX_ACCESS_TOKEN', kind: 'unset' },
      { key: 'CODEX_API_KEY', kind: 'unset' },
      { key: 'openai_api_key', kind: 'unset' },
    ]);
  });

  it('has no Codex API-key edit', () => {
    expect(() => buildUpdateEnv('apiKey', 'codex', [set('CODEX_HOME', '~/c')])).toThrow(
      /No apiKey kind for codex/,
    );
  });

  it('throws when a kept secret was never saved', () => {
    expect(() => buildUpdateEnv('token', 'claude', [])).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/);
  });
});

describe('isJwtShaped', () => {
  it.each([
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl-_', true],
    ['  a.b.c  ', true],
    ['a.b', false],
    ['a.b.c.d', false],
    ['a..c', false],
    ['a.b.c=', false],
    ['a+b.c.d', false],
    ['', false],
    ['sk-proj-abc', false],
  ])('%j → %s', (value, expected) => {
    expect(isJwtShaped(value)).toBe(expected);
  });
});

describe('loginCommand', () => {
  it('returns the plain sign-in command for each provider', () => {
    expect(loginCommand('claude', true)).toBe('claude auth login');
    expect(loginCommand('claude', false)).toBe('claude auth login');
    expect(loginCommand('codex', true)).toBe('codex login');
    expect(loginCommand('codex', false)).toBe('codex login --device-auth');
  });
});

describe('provider lookups', () => {
  it('maps providers to base ids, folder variables and parents', () => {
    expect(baseProviderIdFor('claude')).toBe('claude-code');
    expect(profileProviderFromBaseId('claude-code')).toBe('claude');
    expect(profileProviderFromBaseId('codex')).toBe('codex');
    expect(profileProviderFromBaseId('gemini')).toBeUndefined();
    expect(folderVariableFor('claude')).toBe('CLAUDE_CONFIG_DIR');
    expect(folderVariableFor('codex')).toBe('CODEX_HOME');
    expect(profileFoldersParent('codex')).toBe('~/intent/profiles/codex');
  });
});
