import { describe, expect, it } from 'vitest';
import type { EnvRow } from '$features/settings/profile-env-form';
import {
  accountFolderKeys,
  kindRemoteSupport,
  remoteWarningsForRows,
  rowRemoteWarnings,
} from './provider-remote-ready';

const row = (key: string, value: string, extra: Partial<EnvRow> = {}): EnvRow => ({
  rowId: key,
  key,
  mode: 'value',
  value,
  ...extra,
});

describe('kindRemoteSupport', () => {
  it('marks keys and tokens remote, Different login local, Advanced a choice', () => {
    expect(kindRemoteSupport('apiKey')).toBe('remote');
    expect(kindRemoteSupport('token')).toBe('remote');
    expect(kindRemoteSupport('differentLogin')).toBe('local');
    expect(kindRemoteSupport('advanced')).toBe('choice');
  });
});

describe('rowRemoteWarnings', () => {
  it.each([
    ['GOOGLE_APPLICATION_CREDENTIALS', undefined, ['file-path']],
    ['SOME_CERT', '/etc/ssl/cert.pem', ['file-path']],
    ['SOME_CERT', '~/cert.pem', ['file-path']],
    ['SOME_CERT', 'C:\\certs\\a.pem', ['file-path']],
    ['AWS_PROFILE', 'work', ['aws-profile']],
    ['aws_profile', undefined, ['aws-profile']],
    ['CLAUDE_CODE_API_KEY_HELPER_TTL_MS', '60000', ['api-key-helper']],
    ['ANTHROPIC_BASE_URL', 'http://localhost:4000', ['local-url']],
    ['ANTHROPIC_BASE_URL', 'http://127.0.0.1/v1', ['local-url']],
    ['ANTHROPIC_BASE_URL', 'http://[::1]:8080', ['local-url']],
    ['ANTHROPIC_BASE_URL', 'https://localhost.example.com', []],
    ['ANTHROPIC_BASE_URL', 'https://llm.example.com', []],
    ['CLAUDE_CONFIG_DIR', '~/.claude-work', []],
    ['ANTHROPIC_MODEL', 'opus', []],
  ] as const)('%s=%s → %j', (key, value, expected) => {
    expect(rowRemoteWarnings(key, value)).toEqual(expected);
  });
});

describe('remoteWarningsForRows', () => {
  it('groups keys by reason and skips unset rows', () => {
    const rows = [
      row('GOOGLE_APPLICATION_CREDENTIALS', '~/gcp.json'),
      row('EXTRA_CA', '/etc/ca.pem'),
      row('AWS_PROFILE', '', { mode: 'unset' }),
    ];
    expect(remoteWarningsForRows(rows)).toEqual([
      { reason: 'file-path', keys: ['GOOGLE_APPLICATION_CREDENTIALS', 'EXTRA_CA'] },
    ]);
  });

  it('checks only the key of a row that keeps a masked saved value', () => {
    const saved = { key: 'ANTHROPIC_BASE_URL', mode: 'value' as const };
    expect(remoteWarningsForRows([row('ANTHROPIC_BASE_URL', '', { saved })])).toEqual([]);
    expect(
      remoteWarningsForRows([row('AWS_PROFILE', '', { saved: { ...saved, key: 'AWS_PROFILE' } })]),
    ).toEqual([{ reason: 'aws-profile', keys: ['AWS_PROFILE'] }]);
  });
});

describe('accountFolderKeys', () => {
  it('lists set account folders ignoring case, never unset ones', () => {
    expect(
      accountFolderKeys([
        row('codex_home', '~/.codex-2'),
        row('CLAUDE_CONFIG_DIR', '', { mode: 'unset' }),
        row('ANTHROPIC_MODEL', 'opus'),
      ]),
    ).toEqual(['codex_home']);
  });
});
