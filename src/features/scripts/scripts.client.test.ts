import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptWithState } from './types';
import type { FileContentEntry } from '$store/renderer/slices/files/files-types';

// FAKE seams: the daemon script.* (via appClient.scripts), the daemon file.read
// (via appClient.files), and backendRequest (for repoConfig.get/save) are all
// mocked, so no call reaches a real daemon or the mock router. The tests
// assert the exact wire payloads: saveToRepo MUST source its scripts array
// from the live daemon list (the legacy local store is empty in daemon builds
// — forwarding nothing is what clobbered .intent/config.json with `scripts: []`),
// merge it into the existing config preserving non-script keys, and treat an
// empty list as a no-op. detect() MUST diff manifest candidates against the
// live script.list before upserting through `script.create` (scriptId upsert)
// so repeat clicks don't duplicate rows.
const {
  scriptsList,
  scriptsCreate,
  scriptsRemove,
  filesRead,
  backendRequestMock,
} = vi.hoisted(() => ({
  scriptsList: vi.fn<(workspaceId: string) => Promise<unknown[]>>(() => Promise.resolve([])),
  scriptsCreate: vi.fn(() => Promise.resolve({ success: true })),
  scriptsRemove: vi.fn(() => Promise.resolve({ success: true })),
  filesRead: vi.fn<(workspaceId: string, path: string) => Promise<unknown>>(
    () => Promise.resolve(null),
  ),
  backendRequestMock: vi.fn(() => Promise.resolve({ config: {} })),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    scripts: { list: scriptsList, create: scriptsCreate, remove: scriptsRemove },
    files: { read: filesRead },
  },
}));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
}));

import { scriptsClient } from './scripts.client';

function fileEntry(path: string, content: string): FileContentEntry {
  return {
    path,
    absolutePath: null,
    originalContent: content,
    localContent: content,
    lastUpdated: 0,
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
  };
}

/** Wire `filesRead` to respond from a fixed map of manifest → content. */
function seedManifests(byPath: Record<string, string>): void {
  filesRead.mockImplementation(async (_workspaceId, path) => {
    const content = byPath[path];
    return content !== undefined ? fileEntry(path, content) : null;
  });
}

function liveScript(overrides: Partial<ScriptWithState> = {}): ScriptWithState {
  return {
    id: 'script-1',
    workspaceId: 'ws-1',
    name: 'dev',
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    state: { status: 'idle' },
    ...overrides,
  } as ScriptWithState;
}

describe('scriptsClient.saveToRepo (daemon repoConfig.get/save migration)', () => {
  afterEach(() => vi.clearAllMocks());

  it('fetches the existing repo config, merges scripts[], and persists via repoConfig.save', async () => {
    scriptsList.mockResolvedValueOnce([
      liveScript({
        id: 'script-dev',
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        category: 'dev',
        cwd: 'packages/app',
        env: { NODE_ENV: 'development' },
        autoStart: true,
      }),
      liveScript({ id: 'script-test', name: 'test', command: 'pnpm test', mode: 'command' }),
    ]);
    backendRequestMock.mockResolvedValueOnce({
      config: { branchPrefix: 'feat/', setupScript: './setup.sh' },
    });
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(scriptsList).toHaveBeenCalledWith('ws-1');
    expect(backendRequestMock).toHaveBeenCalledWith('repoConfig.get', { workspaceId: 'ws-1' });
    expect(backendRequestMock).toHaveBeenCalledWith('repoConfig.save', {
      workspaceId: 'ws-1',
      config: {
        branchPrefix: 'feat/',
        setupScript: './setup.sh',
        scripts: [
          {
            name: 'dev',
            command: 'pnpm dev',
            mode: 'service',
            category: 'dev',
            cwd: 'packages/app',
            env: { NODE_ENV: 'development' },
            autoStart: true,
          },
          { name: 'test', command: 'pnpm test', mode: 'command' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('omits undefined optional fields instead of shipping explicit undefined', async () => {
    scriptsList.mockResolvedValueOnce([liveScript()]);
    backendRequestMock.mockResolvedValueOnce({ config: {} });
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    await scriptsClient.saveToRepo('ws-1');

    const saveCall = backendRequestMock.mock.calls[1];
    const savedScripts = (saveCall[1] as { config: { scripts: object[] } }).config.scripts;
    expect(savedScripts[0]).toEqual({ name: 'dev', command: 'pnpm dev', mode: 'service' });
    expect(savedScripts[0]).not.toHaveProperty('category');
    expect(savedScripts[0]).not.toHaveProperty('cwd');
    expect(savedScripts[0]).not.toHaveProperty('env');
    expect(savedScripts[0]).not.toHaveProperty('autoStart');
  });

  it('treats an empty live list as a no-op and never calls repoConfig.save', async () => {
    scriptsList.mockResolvedValueOnce([]);

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(backendRequestMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('preserves all non-script keys when merging', async () => {
    scriptsList.mockResolvedValueOnce([
      liveScript({ name: 'build', command: 'pnpm build', mode: 'command' }),
    ]);
    backendRequestMock.mockResolvedValueOnce({
      config: {
        branchPrefix: 'aw/',
        instructions: 'Use TypeScript strict mode',
        runScript: 'pnpm dev',
        scripts: [{ name: 'old', command: 'echo old', mode: 'command' }],
      },
    });
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    await scriptsClient.saveToRepo('ws-1');

    const saveCall = backendRequestMock.mock.calls[1];
    const savedConfig = (saveCall[1] as { config: object }).config;
    expect(savedConfig).toEqual({
      branchPrefix: 'aw/',
      instructions: 'Use TypeScript strict mode',
      runScript: 'pnpm dev',
      scripts: [{ name: 'build', command: 'pnpm build', mode: 'command' }],
    });
  });

  it('surfaces a backendRequest failure envelope without masking it as success', async () => {
    scriptsList.mockResolvedValueOnce([liveScript()]);
    backendRequestMock.mockRejectedValueOnce(new Error('daemon offline'));

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(result).toEqual({ success: false, error: 'daemon offline' });
  });
});

describe('scriptsClient.detect (fake files + daemon script.* seams)', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads manifests from the daemon and creates new auto-detected scripts', async () => {
    seedManifests({
      'package.json': JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }),
    });
    scriptsList.mockResolvedValueOnce([]);
    scriptsCreate.mockResolvedValue({ success: true });

    const result = await scriptsClient.detect('ws-1');

    expect(filesRead).toHaveBeenCalledWith('ws-1', 'package.json');
    expect(scriptsList).toHaveBeenCalledWith('ws-1');
    expect(scriptsCreate).toHaveBeenCalledTimes(2);
    expect(scriptsCreate).toHaveBeenNthCalledWith(1, 'ws-1', {
      name: 'dev',
      command: 'npm run dev',
      mode: 'service',
      category: 'dev',
    });
    expect(scriptsCreate).toHaveBeenNthCalledWith(2, 'ws-1', {
      name: 'test',
      command: 'npm run test',
      mode: 'command',
      category: 'test',
    });
    expect(scriptsRemove).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      detected: 2,
      added: 2,
      removed: 0,
      packageManager: 'npm',
    });
  });

  it('skips candidates whose name matches an existing user script (sacred) and does not upsert unchanged auto-detected rows', async () => {
    seedManifests({
      'package.json': JSON.stringify({ scripts: { dev: 'vite', build: 'tsc' } }),
    });
    scriptsList.mockResolvedValueOnce([
      liveScript({
        id: 'script-user-dev',
        name: 'dev',
        command: 'my-custom dev',
        mode: 'service',
        source: 'user',
      }),
      liveScript({
        id: 'script-auto-build',
        name: 'build',
        command: 'npm run build',
        mode: 'command',
        category: 'build',
        source: 'auto-detected',
      }),
    ]);

    const result = await scriptsClient.detect('ws-1');

    expect(scriptsCreate).not.toHaveBeenCalled();
    expect(scriptsRemove).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, detected: 2, added: 0, removed: 0 });
  });

  it('upserts an auto-detected script through script.create with the existing scriptId when the command changed', async () => {
    // Existing row was auto-detected under yarn; the workspace now carries a
    // pnpm-lock.yaml so the new command is `pnpm dev` — an upsert (not a
    // create) that reuses the existing scriptId.
    seedManifests({
      'pnpm-lock.yaml': '',
      'package.json': JSON.stringify({ scripts: { dev: 'vite' } }),
    });
    scriptsList.mockResolvedValueOnce([
      liveScript({
        id: 'script-auto-dev',
        name: 'dev',
        command: 'yarn dev',
        mode: 'service',
        category: 'dev',
        source: 'auto-detected',
      }),
    ]);

    const result = await scriptsClient.detect('ws-1');

    expect(scriptsCreate).toHaveBeenCalledTimes(1);
    expect(scriptsCreate).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({
        scriptId: 'script-auto-dev',
        name: 'dev',
        command: 'pnpm dev',
        mode: 'service',
        category: 'dev',
      }),
    );
    expect(result).toMatchObject({ added: 0, removed: 0, packageManager: 'pnpm' });
  });

  it('removes stale auto-detected scripts whose name no longer appears in any manifest', async () => {
    seedManifests({ 'package.json': JSON.stringify({ scripts: { dev: 'vite' } }) });
    scriptsList.mockResolvedValueOnce([
      liveScript({
        id: 'script-auto-dev',
        name: 'dev',
        command: 'npm run dev',
        mode: 'service',
        category: 'dev',
        source: 'auto-detected',
      }),
      liveScript({
        id: 'script-auto-stale',
        name: 'stale',
        command: 'npm run stale',
        mode: 'command',
        source: 'auto-detected',
      }),
    ]);

    const result = await scriptsClient.detect('ws-1');

    expect(scriptsRemove).toHaveBeenCalledTimes(1);
    expect(scriptsRemove).toHaveBeenCalledWith('ws-1', 'script-auto-stale');
    expect(result).toMatchObject({ detected: 1, added: 0, removed: 1 });
  });

  it('surfaces a failure envelope when the manifest read throws', async () => {
    filesRead.mockRejectedValueOnce(new Error('daemon offline'));

    const result = await scriptsClient.detect('ws-1');

    expect(result).toEqual({ success: false, error: 'daemon offline' });
    expect(scriptsCreate).not.toHaveBeenCalled();
    expect(scriptsRemove).not.toHaveBeenCalled();
  });
});
