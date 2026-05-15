import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
} from 'vitest';
import * as fs from 'fs/promises';
import {
  mergeUserMcpServers,
  validateMcpServerConfig,
  readUserMcpServers,
  getGlobalDisabledMcpServers,
  getWorkspaceDisabledMcpServers,
  type McpServerConfig,
} from '../main/user-mcp-settings';
import {
  RESERVED_MCP_SERVER_NAMES,
  MCP_SERVER_NAME_REGEX,
  MCP_SERVER_NAME_MAX_LENGTH,
} from '../../../shared/config/mcp-constants';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// Mock the logger to suppress output
vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    debug = vi.fn();
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

// Mock mcp-auth-providers to avoid side effects
vi.mock('../main/mcp-auth-providers', () => ({
  injectMcpAuth: vi.fn((config: unknown) => config),
}));

// Mock shared/main/config for workspace paths
vi.mock('../../../shared/main/config', () => ({
  WorkspaceConfig: {
    paths: {
      metadata: (workspaceId: string) => `/mock/workspaces/${workspaceId}/.workspace`,
    },
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// mergeUserMcpServers
// =============================================================================
describe('mergeUserMcpServers', () => {
  const builtIn = { 'workspace-mcp': { type: 'stdio', command: 'node' } };

  it('returns built-in servers when userServers is null', () => {
    const result = mergeUserMcpServers(builtIn, null);
    expect(result.servers).toEqual(builtIn);
    expect(result.conflicts).toEqual([]);
  });

  it('merges user servers with built-in servers without conflicts', () => {
    const userServers: Record<string, McpServerConfig> = {
      sentry: { command: 'sentry-mcp', args: [] },
    };
    const result = mergeUserMcpServers(builtIn, userServers);
    expect(result.servers).toHaveProperty('workspace-mcp');
    expect(result.servers).toHaveProperty('sentry');
    expect(result.conflicts).toEqual([]);
  });

  it('reports conflict for reserved name workspace-mcp', () => {
    const userServers: Record<string, McpServerConfig> = {
      'workspace-mcp': { command: 'override', args: [] },
    };
    const result = mergeUserMcpServers(builtIn, userServers);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toContain('workspace-mcp');
    expect(result.servers['workspace-mcp']).toEqual(builtIn['workspace-mcp']);
  });

  it('filters reserved names but keeps valid user servers', () => {
    const userServers: Record<string, McpServerConfig> = {
      'workspace-mcp': { command: 'bad', args: [] },
      'my-server': { command: 'good', args: [] },
    };
    const result = mergeUserMcpServers(builtIn, userServers);
    expect(result.servers).toHaveProperty('my-server');
    expect(result.conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty conflicts for empty user servers', () => {
    const result = mergeUserMcpServers(builtIn, {});
    expect(result.servers).toEqual(builtIn);
    expect(result.conflicts).toEqual([]);
  });

  it('reports conflict when user server collides with non-reserved built-in', () => {
    const builtInWithExtra = { ...builtIn, 'custom-builtin': { command: 'x' } };
    const userServers: Record<string, McpServerConfig> = {
      'custom-builtin': { command: 'override', args: [] },
    };
    const result = mergeUserMcpServers(builtInWithExtra, userServers);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toContain('custom-builtin');
  });
});

// =============================================================================
// validateMcpServerConfig
// =============================================================================
describe('validateMcpServerConfig', () => {
  it('rejects null/undefined', () => {
    expect(validateMcpServerConfig(null).valid).toBe(false);
    expect(validateMcpServerConfig(undefined).valid).toBe(false);
  });

  it('rejects non-object values', () => {
    expect(validateMcpServerConfig('string').valid).toBe(false);
    expect(validateMcpServerConfig(42).valid).toBe(false);
  });

  it('validates valid http server', () => {
    expect(validateMcpServerConfig({ type: 'http', url: 'http://localhost:3000' })).toEqual({
      valid: true,
    });
  });

  it('validates valid sse server', () => {
    expect(validateMcpServerConfig({ type: 'sse', url: 'http://localhost:3000/sse' })).toEqual({
      valid: true,
    });
  });

  it('rejects http server without url', () => {
    const result = validateMcpServerConfig({ type: 'http' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('url');
  });

  it('rejects invalid type', () => {
    const result = validateMcpServerConfig({ type: 'websocket', url: 'ws://localhost' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('websocket');
  });

  it('validates valid command server', () => {
    expect(validateMcpServerConfig({ command: 'node', args: ['server.js'] })).toEqual({
      valid: true,
    });
  });

  it('rejects command server with empty command', () => {
    expect(validateMcpServerConfig({ command: '' }).valid).toBe(false);
  });

  it('rejects command server with non-array args', () => {
    const result = validateMcpServerConfig({ command: 'node', args: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('args');
  });

  it('rejects object with neither type nor command', () => {
    expect(validateMcpServerConfig({ url: 'http://localhost' }).valid).toBe(false);
  });

  it('rejects http server with non-object headers', () => {
    const result = validateMcpServerConfig({ type: 'http', url: 'http://x', headers: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('headers');
  });

  it('rejects command server with non-object env', () => {
    const result = validateMcpServerConfig({ command: 'node', env: 'bad' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('env');
  });
});



// =============================================================================
// readUserMcpServers (also tests parseLenientJson indirectly)
// =============================================================================
describe('readUserMcpServers', () => {
  it('returns null when settings file does not exist', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fs.readFile).mockRejectedValue(err);

    const result = await readUserMcpServers();
    expect(result).toBeNull();
  });

  it('returns null when file has no mcpServers key', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ otherSetting: true }));

    const result = await readUserMcpServers();
    expect(result).toBeNull();
  });

  it('returns servers from valid JSON', async () => {
    const settings = {
      mcpServers: {
        sentry: { command: 'sentry-mcp', args: ['--stdio'] },
      },
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(settings));

    const result = await readUserMcpServers();
    expect(result).toEqual(settings.mcpServers);
  });

  it('handles JSON with trailing commas (lenient parsing)', async () => {
    const jsonWithTrailingCommas = `{
      "mcpServers": {
        "my-server": {
          "command": "node",
          "args": ["server.js",],
        },
      },
    }`;
    vi.mocked(fs.readFile).mockResolvedValue(jsonWithTrailingCommas);

    const result = await readUserMcpServers();
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('my-server');
    expect(result!['my-server']).toEqual({ command: 'node', args: ['server.js'] });
  });

  it('returns null when file contains completely invalid JSON', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('not json at all {{{');

    const result = await readUserMcpServers();
    expect(result).toBeNull();
  });

  it('returns null when mcpServers is not an object', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ mcpServers: 'not-an-object' }));

    const result = await readUserMcpServers();
    expect(result).toBeNull();
  });

  it('returns null on non-ENOENT read errors', async () => {
    const err = new Error('Permission denied') as NodeJS.ErrnoException;
    err.code = 'EACCES';
    vi.mocked(fs.readFile).mockRejectedValue(err);

    const result = await readUserMcpServers();
    expect(result).toBeNull();
  });
});

// =============================================================================
// MCP Server Name Validation (shared constants from mcp-constants.ts)
// =============================================================================
describe('MCP_SERVER_NAME_REGEX', () => {
  it.each(['sentry', 'my-server', 'server_1', 'sentry.io', 'a', 'a-b.c_d', 'MyServer123'])(
    'accepts valid name: %s',
    (name) => {
      expect(MCP_SERVER_NAME_REGEX.test(name)).toBe(true);
    },
  );

  it.each(['', ' ', 'my server', '@sentry', '#channel', 'hello world', 'a/b', 'a:b'])(
    'rejects invalid name: "%s"',
    (name) => {
      expect(MCP_SERVER_NAME_REGEX.test(name)).toBe(false);
    },
  );
});

describe('MCP_SERVER_NAME_MAX_LENGTH', () => {
  it('is 64', () => {
    expect(MCP_SERVER_NAME_MAX_LENGTH).toBe(64);
  });

  it('rejects names longer than max length', () => {
    const longName = 'a'.repeat(65);
    expect(longName.length).toBeGreaterThan(MCP_SERVER_NAME_MAX_LENGTH);
  });

  it('accepts names at max length', () => {
    const maxName = 'a'.repeat(64);
    expect(maxName.length).toBeLessThanOrEqual(MCP_SERVER_NAME_MAX_LENGTH);
    expect(MCP_SERVER_NAME_REGEX.test(maxName)).toBe(true);
  });
});

describe('RESERVED_MCP_SERVER_NAMES', () => {
  it('includes workspace-mcp', () => {
    expect(RESERVED_MCP_SERVER_NAMES).toContain('workspace-mcp');
  });

  it('is a readonly array', () => {
    expect(Array.isArray(RESERVED_MCP_SERVER_NAMES)).toBe(true);
  });
});

// =============================================================================
// getGlobalDisabledMcpServers
// =============================================================================
describe('getGlobalDisabledMcpServers', () => {
  it('returns array of disabled server names from the reader function', () => {
    const mockReader = vi.fn().mockReturnValue(['Figma', 'Augment Context Connectors']);

    const result = getGlobalDisabledMcpServers(mockReader);
    expect(result).toEqual(['Figma', 'Augment Context Connectors']);
    expect(mockReader).toHaveBeenCalled();
  });

  it('filters out non-string entries from the array', () => {
    const mockReader = vi.fn().mockReturnValue(['Figma', null, 123, 'Snyk', undefined]);

    const result = getGlobalDisabledMcpServers(mockReader);
    expect(result).toEqual(['Figma', 'Snyk']);
  });

  it('returns empty array when reader returns undefined', () => {
    const mockReader = vi.fn().mockReturnValue(undefined);

    const result = getGlobalDisabledMcpServers(mockReader);
    expect(result).toEqual([]);
  });

  it('returns empty array when reader returns non-array', () => {
    const mockReader = vi.fn().mockReturnValue('not-an-array');

    const result = getGlobalDisabledMcpServers(mockReader);
    expect(result).toEqual([]);
  });

  it('returns empty array when reader throws', () => {
    const mockReader = vi.fn().mockImplementation(() => {
      throw new Error('Store corrupted');
    });

    const result = getGlobalDisabledMcpServers(mockReader);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// getWorkspaceDisabledMcpServers
// =============================================================================
describe('getWorkspaceDisabledMcpServers', () => {
  it('returns workspace-specific disabled servers when file exists', async () => {
    const workspaceData = { disabledServers: ['Snyk'] };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceData));

    const result = await getWorkspaceDisabledMcpServers('ws-123');
    expect(result).toEqual(['Snyk']);
  });

  it('returns null when workspace file does not exist', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    vi.mocked(fs.readFile).mockRejectedValue(err);

    const result = await getWorkspaceDisabledMcpServers('ws-new');
    expect(result).toBeNull();
  });

  it('returns null when file has no disabledServers array', async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ otherKey: true }));

    const result = await getWorkspaceDisabledMcpServers('ws-incomplete');
    expect(result).toBeNull();
  });

  it('returns empty array when workspace explicitly has no disabled servers', async () => {
    // disabledServers: [] means "user enabled everything" — must NOT be treated as null
    const workspaceData = { disabledServers: [] };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceData));

    const result = await getWorkspaceDisabledMcpServers('ws-all-enabled');
    expect(result).toEqual([]);
  });

  it('filters out non-string entries from workspace disabled list', async () => {
    const workspaceData = { disabledServers: ['Snyk', null, 42, 'Figma', undefined] };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceData));

    const result = await getWorkspaceDisabledMcpServers('ws-corrupted');
    expect(result).toEqual(['Snyk', 'Figma']);
  });

  it('returns workspace-specific list regardless of global state', async () => {
    const workspaceData = { disabledServers: ['Snyk'] };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceData));

    const result = await getWorkspaceDisabledMcpServers('ws-override');
    expect(result).toEqual(['Snyk']);
  });
});