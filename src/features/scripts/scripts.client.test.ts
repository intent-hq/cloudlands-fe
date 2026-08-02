import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScriptWithState } from './types';
import type { FileContentEntry } from '$store/renderer/slices/files/files-types';

// FAKE seams: the daemon script.* (via appClient.scripts), the daemon file.read
// (via appClient.files), and backendRequest (for repoConfig.save) are all
// mocked, so no call reaches a real daemon or the mock router. The tests
// assert the exact wire payloads: saveToRepo MUST source its scripts array
// from the live daemon list (the legacy local store is empty in daemon builds
// — forwarding nothing is what clobbered .intent/config.json with `scripts: []`),
// send ONLY the `scripts` field (repoConfig.save merges the patch server-side;
// rebuilding the full config from a stale repoConfig.get read is what reverted
// setupScript in monorepo PR #270), and treat an empty list as a no-op.
// detect() MUST diff manifest candidates against the live script.list before
// upserting through `script.create` (scriptId upsert) so repeat clicks don't
// duplicate rows, and MUST NOT send the upsert when the target script's
// runtime status is `running` — the daemon-side upsert tears down the live
// PTY group (§5.8).
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

/** §5.8 `script.list` entry: camelCase definition + merged `runtime` block. */
function liveScript(overrides: Partial<ScriptWithState> = {}): ScriptWithState {
  return {
    id: 'script-1',
    workspaceId: 'ws-1',
    name: 'dev',
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    runtime: { status: 'idle', restartCount: 0 },
    ...overrides,
  } as ScriptWithState;
}

describe('scriptsClient.saveToRepo (repoConfig.save partial-update semantics)', () => {
  afterEach(() => vi.clearAllMocks());

  it('persists only the scripts field via repoConfig.save', async () => {
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
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    const result = await scriptsClient.saveToRepo('ws-1');

    expect(scriptsList).toHaveBeenCalledWith('ws-1');
    expect(backendRequestMock).toHaveBeenCalledTimes(1);
    expect(backendRequestMock).toHaveBeenCalledWith('repoConfig.save', {
      workspaceId: 'ws-1',
      config: {
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

  it('never fetches the existing config nor forwards unrelated fields (regression: stale full-object save reverted setupScript)', async () => {
    scriptsList.mockResolvedValueOnce([
      liveScript({ name: 'build', command: 'pnpm build', mode: 'command' }),
    ]);
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    await scriptsClient.saveToRepo('ws-1');

    expect(backendRequestMock).not.toHaveBeenCalledWith('repoConfig.get', expect.anything());
    const [method, params] = backendRequestMock.mock.calls[0];
    expect(method).toBe('repoConfig.save');
    const config = (params as { config: object }).config;
    expect(Object.keys(config)).toEqual(['scripts']);
    expect(config).not.toHaveProperty('setupScript');
    expect(config).not.toHaveProperty('branchPrefix');
    expect(config).not.toHaveProperty('instructions');
  });

  it('omits undefined optional fields instead of shipping explicit undefined', async () => {
    scriptsList.mockResolvedValueOnce([liveScript()]);
    backendRequestMock.mockResolvedValueOnce({ config: {} });

    await scriptsClient.saveToRepo('ws-1');

    const saveCall = backendRequestMock.mock.calls[0];
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
    expect(result).not.toHaveProperty('skippedRunning');
  });

  it('never sends the script.create upsert when the target script is running — skips and reports it', async () => {
    // Same changed-command diff as the upsert case above, but the existing
    // auto-detected row is `running` per the daemon (§5.8 runtime block). The
    // scriptId upsert would tear down the live PTY group daemon-side, so no
    // script.create may go out on the wire; the script is reported back in
    // `skippedRunning` instead.
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
        runtime: { status: 'running', pid: 4242, restartCount: 0 },
      }),
    ]);

    const result = await scriptsClient.detect('ws-1');

    expect(scriptsCreate).not.toHaveBeenCalled();
    expect(scriptsRemove).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      detected: 1,
      added: 0,
      removed: 0,
      skippedRunning: ['dev'],
    });
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
