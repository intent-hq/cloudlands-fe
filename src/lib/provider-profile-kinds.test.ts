import { describe, expect, it } from 'vitest';
import type { EnvEntryRead } from '$shared/provider-profiles';
import {
  MASKED_ENV_VALUE,
  baseProviderIdFor,
  buildCreatePayload,
  buildUpdateEnv,
  detectProfileKind,
  folderVariableFor,
  hasProfileKinds,
  isJwtShaped,
  isSecretWellFormed,
  loginCommand,
  pickUnusedFolder,
  profileFoldersParent,
  profileKindsFor,
  profileProviderFromBaseId,
  randomSuffix,
  singleProfileKind,
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
    [
      'codex api key',
      'codex',
      [set('CODEX_API_KEY'), unset('CODEX_ACCESS_TOKEN'), unset('OPENAI_API_KEY')],
      'apiKey',
    ],
    ['codex api key without unsets', 'codex', [set('CODEX_API_KEY')], 'apiKey'],
    [
      'codex api key + base url',
      'codex',
      [set('CODEX_API_KEY'), set('ANTHROPIC_BASE_URL')],
      'advanced',
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

  it('Codex API key: CODEX_API_KEY + the other two credentials unset, never a base URL', () => {
    expect(
      buildCreatePayload('apiKey', 'codex', {
        name: 'W',
        apiKey: ' sk-proj-1 ',
        baseUrl: 'https://ignored',
      }).env,
    ).toEqual([
      { key: 'CODEX_API_KEY', kind: 'set', value: 'sk-proj-1' },
      { key: 'CODEX_ACCESS_TOKEN', kind: 'unset' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ]);
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
      ['codex', 'apiKey'],
      ['codex', 'token'],
      ['grok', 'apiKey'],
      ['droid', 'apiKey'],
      ['auggie', 'token'],
      ['cursor', 'apiKey'],
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

  it('keeps or replaces a Codex API key and never adds a base URL', () => {
    expect(
      buildUpdateEnv('apiKey', 'codex', [set('CODEX_API_KEY')], { baseUrl: 'https://x' }),
    ).toEqual([
      { key: 'CODEX_API_KEY', kind: 'keep' },
      { key: 'CODEX_ACCESS_TOKEN', kind: 'unset' },
      { key: 'OPENAI_API_KEY', kind: 'unset' },
    ]);
    expect(
      buildUpdateEnv('apiKey', 'codex', [set('CODEX_API_KEY')], { apiKey: 'sk-new' })[0],
    ).toEqual({ key: 'CODEX_API_KEY', kind: 'set', value: 'sk-new' });
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
    expect(loginCommand('claude')).toBe('claude auth login');
    expect(loginCommand('codex')).toBe('codex login --device-auth');
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

describe('isSecretWellFormed', () => {
  const pad = 'A1b2C3d4E5f6G7h8I9j0K1l2';
  const rows: [string, ProfileProvider, 'apiKey' | 'token', string, boolean][] = [
    ['claude api key', 'claude', 'apiKey', `sk-ant-api03-${pad}`, true],
    ['claude api key, padded', 'claude', 'apiKey', `  sk-ant-api03-${pad}\n`, true],
    ['claude setup token as api key', 'claude', 'apiKey', `sk-ant-oat01-${pad}`, false],
    ['claude api key, too short', 'claude', 'apiKey', 'sk-ant-api03-x', false],
    ['openai key as claude key', 'claude', 'apiKey', `sk-proj-${pad}`, false],
    ['claude token', 'claude', 'token', `sk-ant-oat01-${pad}`, true],
    ['claude api key as token', 'claude', 'token', `sk-ant-api03-${pad}`, false],
    ['claude token with a space', 'claude', 'token', `sk-ant-oat01-${pad} x`, false],
    ['codex api key', 'codex', 'apiKey', `sk-proj-${pad}`, true],
    ['codex legacy api key', 'codex', 'apiKey', `sk-${pad}`, true],
    ['claude key as codex key', 'codex', 'apiKey', `sk-ant-api03-${pad}`, false],
    ['codex api key, no prefix', 'codex', 'apiKey', pad, false],
    ['codex token', 'codex', 'token', 'eyJh.eyJz.c2ln', true],
    ['codex token, two parts', 'codex', 'token', 'eyJh.eyJz', false],
    ['empty', 'codex', 'apiKey', '   ', false],
  ];
  it.each(rows)('%s', (_label, provider, kind, value, expected) => {
    expect(isSecretWellFormed(provider, kind, value)).toBe(expected);
  });

  it('accepts any key without spaces for a Claude Custom endpoint', () => {
    expect(
      isSecretWellFormed('claude', 'apiKey', 'gateway-key-123', { customEndpoint: true }),
    ).toBe(true);
    expect(isSecretWellFormed('claude', 'apiKey', 'gateway key', { customEndpoint: true })).toBe(
      false,
    );
  });
});

describe('providers with profile kinds', () => {
  it('maps every base id and offers only its own kinds', () => {
    const rows: [string, ProfileProvider, string[]][] = [
      ['claude-code', 'claude', ['differentLogin', 'apiKey', 'token']],
      ['codex', 'codex', ['differentLogin', 'apiKey', 'token']],
      ['grok', 'grok', ['apiKey']],
      ['droid', 'droid', ['apiKey']],
      ['auggie', 'auggie', ['token']],
      ['cursor', 'cursor', ['apiKey']],
    ];
    for (const [baseId, provider, kinds] of rows) {
      expect(profileProviderFromBaseId(baseId)).toBe(provider);
      expect(baseProviderIdFor(provider)).toBe(baseId);
      expect(profileKindsFor(provider)).toEqual(kinds);
    }
    expect(profileProviderFromBaseId('opencode')).toBeUndefined();
    expect(hasProfileKinds({ id: 'grok', supportsProfiles: true })).toBe(true);
    expect(hasProfileKinds({ id: 'cursor', supportsProfiles: false })).toBe(false);
    expect(hasProfileKinds({ id: 'opencode', supportsProfiles: true })).toBe(false);
  });

  it('saves one credential each, unsetting only Cursor’s other credential', () => {
    const env = (provider: ProfileProvider, kind: 'apiKey' | 'token') =>
      buildCreatePayload(kind, provider, { name: 'n', apiKey: ' k ', token: ' k ' }).env;
    expect(env('grok', 'apiKey')).toEqual([{ key: 'XAI_API_KEY', kind: 'set', value: 'k' }]);
    expect(env('droid', 'apiKey')).toEqual([{ key: 'FACTORY_API_KEY', kind: 'set', value: 'k' }]);
    expect(env('cursor', 'apiKey')).toEqual([
      { key: 'CURSOR_API_KEY', kind: 'set', value: 'k' },
      { key: 'CURSOR_AUTH_TOKEN', kind: 'unset' },
    ]);
    expect(env('auggie', 'token')).toEqual([
      { key: 'AUGMENT_SESSION_AUTH', kind: 'set', value: 'k' },
    ]);
    expect(buildCreatePayload('apiKey', 'grok', { name: 'n', apiKey: 'k' }).baseProviderId).toBe(
      'grok',
    );
  });

  it('names the only kind of a single-kind provider, so the picker is skipped', () => {
    expect(singleProfileKind('grok')).toBe('apiKey');
    expect(singleProfileKind('droid')).toBe('apiKey');
    expect(singleProfileKind('cursor')).toBe('apiKey');
    expect(singleProfileKind('auggie')).toBe('token');
    expect(singleProfileKind('claude')).toBeUndefined();
    expect(singleProfileKind('codex')).toBeUndefined();
  });

  it('refuses a kind the provider does not offer', () => {
    expect(() => buildCreatePayload('token', 'grok', { name: 'n', token: 't' })).toThrow();
    expect(() =>
      buildCreatePayload('differentLogin', 'cursor', { name: 'n', folder: '~/f' }),
    ).toThrow();
    expect(() => loginCommand('grok')).toThrow();
    expect(() => folderVariableFor('cursor')).toThrow();
    expect(savedFolderPath('grok', [set('GROK_HOME', '~/g')])).toBeUndefined();
    // A Grok profile with only a folder is Advanced: Grok has no Different login kind.
    expect(detectProfileKind('grok', [set('GROK_HOME', '~/g')])).toBe('advanced');
    expect(detectProfileKind('cursor', [set('CURSOR_API_KEY'), unset('CURSOR_AUTH_TOKEN')])).toBe(
      'apiKey',
    );
    expect(detectProfileKind('cursor', [set('CURSOR_AUTH_TOKEN')])).toBe('advanced');
  });
});

describe('Auggie access token', () => {
  const json =
    '{"accessToken":"tok","tenantURL":"https://d1.api.augmentcode.com/","scopes":["email"]}';
  const printed = `🔑 Augment authentication session:\n\nSESSION=${json}\n\n💡 Usage for automation:\n\nexport AUGMENT_SESSION_AUTH=$SESSION\n`;

  it('saves the session JSON whether the JSON or a padded paste is given', () => {
    for (const token of [json, `  ${json}\n`]) {
      expect(buildCreatePayload('token', 'auggie', { name: 'n', token }).env).toEqual([
        { key: 'AUGMENT_SESSION_AUTH', kind: 'set', value: json },
      ]);
    }
  });

  it('saves only the session JSON', () => {
    expect(buildCreatePayload('token', 'auggie', { name: 'n', token: printed }).env).toEqual([
      { key: 'AUGMENT_SESSION_AUTH', kind: 'set', value: json },
    ]);
    expect(
      buildUpdateEnv('token', 'auggie', [set('AUGMENT_SESSION_AUTH')], { token: printed }),
    ).toEqual([{ key: 'AUGMENT_SESSION_AUTH', kind: 'set', value: json }]);
  });

  it.each([
    ['the JSON', json, true],
    ['the whole printed output', printed, true],
    ['no scopes', '{"accessToken":"t","tenantURL":"https://x/"}', false],
    ['an http tenant', '{"accessToken":"t","tenantURL":"http://x/","scopes":[]}', false],
    ['an empty token', '{"accessToken":" ","tenantURL":"https://x/","scopes":[]}', false],
    ['an array', '[1]', false],
    ['not JSON', 'abc', false],
  ])('%s', (_label, value, expected) => {
    expect(isSecretWellFormed('auggie', 'token', value)).toBe(expected);
  });
});

describe('isSecretWellFormed for Grok, Droid and Cursor', () => {
  const pad = 'A1b2C3d4E5f6G7h8I9j0K1l2';
  it.each([
    ['grok key', 'grok', `xai-${pad}`, true],
    ['grok key, padded', 'grok', ` xai-${pad}\n`, true],
    ['grok key, too short', 'grok', 'xai-abc', false],
    ['grok key with a dash in the body', 'grok', `xai-${pad}-x`, false],
    ['openai key as grok key', 'grok', `sk-${pad}`, false],
    ['droid key', 'droid', `fk-${pad}`, true],
    ['droid key with _ and -', 'droid', `fk-${pad}_x-y`, true],
    ['droid key, no prefix', 'droid', pad, false],
    ['cursor key', 'cursor', `key_${pad}${pad}`, true],
    ['cursor key, 31 characters', 'cursor', 'a'.repeat(31), false],
    ['cursor key, 32 characters', 'cursor', 'a'.repeat(32), true],
    ['cursor key with a space', 'cursor', `${pad} ${pad}`, false],
    ['empty', 'cursor', '   ', false],
  ] as [string, ProfileProvider, string, boolean][])('%s', (_label, provider, value, expected) => {
    expect(isSecretWellFormed(provider, 'apiKey', value)).toBe(expected);
  });

  it('has no token kind for Grok, Droid or Cursor, nor an API key for Auggie', () => {
    expect(isSecretWellFormed('grok', 'token', 'x'.repeat(40))).toBe(false);
    expect(isSecretWellFormed('auggie', 'apiKey', 'x'.repeat(40))).toBe(false);
  });
});
