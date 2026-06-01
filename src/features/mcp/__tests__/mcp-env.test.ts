import { describe, it, expect } from 'vitest';
import {
  buildBaselineMcpEnv,
  mergeMcpEnv,
  applyBaselineEnvToStdioServers,
  redactMcpEnvForLogging,
  isLikelySecretEnvKey,
  REDACTED_VALUE,
} from '../main/mcp-env';

describe('buildBaselineMcpEnv', () => {
  it('copies parent env values', () => {
    const baseline = buildBaselineMcpEnv({ PATH: '/usr/bin', HOME: '/home/user' });
    expect(baseline).toEqual({ PATH: '/usr/bin', HOME: '/home/user' });
  });

  it('drops undefined values', () => {
    const baseline = buildBaselineMcpEnv({ PATH: '/usr/bin', MISSING: undefined });
    expect(baseline).toEqual({ PATH: '/usr/bin' });
    expect('MISSING' in baseline).toBe(false);
  });

  it('drops Intent-controlled keys so they are set only via overrides', () => {
    const baseline = buildBaselineMcpEnv({
      PATH: '/usr/bin',
      ELECTRON_RUN_AS_NODE: '1',
    });
    expect(baseline).toEqual({ PATH: '/usr/bin' });
    expect('ELECTRON_RUN_AS_NODE' in baseline).toBe(false);
  });

  it('drops well-known host secret keys while keeping non-secret vars', () => {
    const baseline = buildBaselineMcpEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      ANTHROPIC_API_KEY: 'fake', // pragma: allowlist secret
      GITHUB_TOKEN: 'fake', // pragma: allowlist secret
      AWS_SECRET_ACCESS_KEY: 'fake', // pragma: allowlist secret
    });
    expect(baseline).toEqual({ PATH: '/usr/bin', HOME: '/home/user' });
    expect('ANTHROPIC_API_KEY' in baseline).toBe(false);
    expect('GITHUB_TOKEN' in baseline).toBe(false);
    expect('AWS_SECRET_ACCESS_KEY' in baseline).toBe(false);
  });

  it('drops pattern-matched secret keys but keeps benign vars', () => {
    const baseline = buildBaselineMcpEnv({
      PATH: '/usr/bin',
      HOME: '/home/user',
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
      SOME_SERVICE_API_KEY: 'fake', // pragma: allowlist secret
      MY_TOKEN: 'fake', // pragma: allowlist secret
      DB_PASSWORD: 'fake', // pragma: allowlist secret
    });
    expect(baseline).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/user',
      SHELL: '/bin/zsh',
      LANG: 'en_US.UTF-8',
      TMPDIR: '/tmp',
      SSH_AUTH_SOCK: '/tmp/ssh-agent.sock',
    });
  });
});

describe('isLikelySecretEnvKey', () => {
  it('flags explicit denylist keys', () => {
    expect(isLikelySecretEnvKey('OPENAI_API_KEY')).toBe(true);
    expect(isLikelySecretEnvKey('GH_TOKEN')).toBe(true);
    expect(isLikelySecretEnvKey('FIGMA_TOKEN')).toBe(true);
  });

  it('flags pattern-matched secret keys', () => {
    expect(isLikelySecretEnvKey('SOME_SERVICE_API_KEY')).toBe(true);
    expect(isLikelySecretEnvKey('MY_TOKEN')).toBe(true);
    expect(isLikelySecretEnvKey('DB_PASSWORD')).toBe(true);
    expect(isLikelySecretEnvKey('CLIENT_SECRET')).toBe(true);
    expect(isLikelySecretEnvKey('SERVICE_PRIVATE_KEY')).toBe(true);
    expect(isLikelySecretEnvKey('app_credentials')).toBe(true);
  });

  it('does not flag benign environment vars', () => {
    for (const key of ['PATH', 'HOME', 'SHELL', 'LANG', 'TMPDIR', 'SSH_AUTH_SOCK', 'USER']) {
      expect(isLikelySecretEnvKey(key)).toBe(false);
    }
  });
});

describe('mergeMcpEnv', () => {
  it('lets later layers win over earlier layers', () => {
    const merged = mergeMcpEnv(
      { PATH: '/usr/bin', WORKSPACE_ID: 'baseline' },
      { WORKSPACE_ID: 'override' },
    );
    expect(merged.PATH).toBe('/usr/bin');
    expect(merged.WORKSPACE_ID).toBe('override');
  });

  it('ignores undefined and nullish layers', () => {
    const merged = mergeMcpEnv({ PATH: '/usr/bin' }, undefined, null, {
      HTTP_MCP_PORT: undefined,
    });
    expect(merged).toEqual({ PATH: '/usr/bin' });
  });

  it('does not let an undefined override blank a baseline value', () => {
    const merged = mergeMcpEnv({ WORKSPACE_ID: 'baseline' }, { WORKSPACE_ID: undefined });
    expect(merged.WORKSPACE_ID).toBe('baseline');
  });
});

describe('applyBaselineEnvToStdioServers', () => {
  const parentEnv = { PATH: '/usr/bin', HOME: '/home/user', ELECTRON_RUN_AS_NODE: '1' };

  it('merges baseline into a stdio server while preserving its explicit env', () => {
    const servers = {
      'user-server': {
        command: 'my-mcp',
        args: ['--flag'],
        env: { USER_TOKEN: 'fake-token-value' }, // pragma: allowlist secret
      },
    };

    const result = applyBaselineEnvToStdioServers(servers, parentEnv);

    expect(result['user-server'].env).toMatchObject({
      PATH: '/usr/bin',
      HOME: '/home/user',
      USER_TOKEN: 'fake-token-value',
    });
    // Controlled key is not inherited from the parent baseline.
    expect('ELECTRON_RUN_AS_NODE' in result['user-server'].env).toBe(false);
    // Original args are preserved.
    expect(result['user-server'].args).toEqual(['--flag']);
  });

  it('lets the explicit server env override the baseline', () => {
    const servers = {
      'workspace-mcp': {
        command: '/path/electron',
        args: [],
        env: { PATH: '/override/bin', ELECTRON_RUN_AS_NODE: '1', HTTP_MCP_PORT: '5179' },
      },
    };

    const result = applyBaselineEnvToStdioServers(servers, parentEnv);

    expect(result['workspace-mcp'].env.PATH).toBe('/override/bin');
    expect(result['workspace-mcp'].env.HTTP_MCP_PORT).toBe('5179');
    // Override re-introduces the controlled key intentionally.
    expect(result['workspace-mcp'].env.ELECTRON_RUN_AS_NODE).toBe('1');
    expect(result['workspace-mcp'].env.HOME).toBe('/home/user');
  });

  it('lets an explicit server env re-introduce a denylisted secret (server env wins)', () => {
    const envWithSecret = {
      PATH: '/usr/bin',
      GITHUB_TOKEN: 'host-secret', // pragma: allowlist secret
    };
    const servers = {
      'user-server': {
        command: 'my-mcp',
        env: { GITHUB_TOKEN: 'server-provided' }, // pragma: allowlist secret
      },
    };

    const result = applyBaselineEnvToStdioServers(servers, envWithSecret);

    // The host secret is filtered from the baseline, but the explicit server env
    // value is preserved and wins.
    expect(result['user-server'].env.GITHUB_TOKEN).toBe('server-provided');
    expect(result['user-server'].env.PATH).toBe('/usr/bin');
  });

  it('supplies a baseline env to stdio servers that declared none', () => {
    const servers = { bare: { command: 'bare-mcp' } };
    const result = applyBaselineEnvToStdioServers(servers, parentEnv);
    expect(result.bare.env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/user' });
  });

  it('leaves http/sse servers untouched', () => {
    const servers = {
      remote: { type: 'http', url: 'https://example.com', headers: { Authorization: 'Bearer x' } }, // pragma: allowlist secret
    };
    const result = applyBaselineEnvToStdioServers(servers, parentEnv);
    expect(result.remote).toEqual(servers.remote);
    expect('env' in result.remote).toBe(false);
  });
});

describe('redactMcpEnvForLogging', () => {
  it('masks env and header values but keeps keys', () => {
    const config = {
      mcpServers: {
        'user-server': {
          command: 'my-mcp',
          args: ['--flag'],
          env: { USER_TOKEN: 'fake-token-value', PATH: '/usr/bin' }, // pragma: allowlist secret
        },
        remote: { type: 'http', url: 'https://example.com', headers: { Authorization: 'Bearer fake' } }, // pragma: allowlist secret
      },
    };

    const redacted = redactMcpEnvForLogging(config);

    const userEnv = (redacted.mcpServers['user-server'] as { env: Record<string, string> }).env;
    expect(Object.keys(userEnv).sort()).toEqual(['PATH', 'USER_TOKEN']);
    expect(userEnv.USER_TOKEN).toBe(REDACTED_VALUE);
    expect(userEnv.PATH).toBe(REDACTED_VALUE);

    const remoteHeaders = (redacted.mcpServers.remote as { headers: Record<string, string> })
      .headers;
    expect(remoteHeaders.Authorization).toBe(REDACTED_VALUE);

    // Non-secret structural fields are preserved.
    expect((redacted.mcpServers['user-server'] as { command: string }).command).toBe('my-mcp');
    expect((redacted.mcpServers.remote as { url: string }).url).toBe('https://example.com');
  });

  it('does not mutate the original config', () => {
    const config = {
      mcpServers: { s: { command: 'm', env: { TOKEN: 'fake' } } }, // pragma: allowlist secret
    };
    redactMcpEnvForLogging(config);
    expect(config.mcpServers.s.env.TOKEN).toBe('fake');
  });
});
