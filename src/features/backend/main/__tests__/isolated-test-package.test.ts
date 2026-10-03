import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const spawn = vi.hoisted(() => vi.fn());
const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  removeAllListeners: vi.fn(),
}));
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn, default: { ...actual, spawn } };
});
vi.mock('child_process', async (original) => {
  const actual = await original<typeof import('child_process')>();
  return { ...actual, spawn, default: { ...actual, spawn } };
});
vi.mock('../../../../main/build-config.generated.js', () => ({
  BUILD_CONFIG: {
    GIT_COMMIT_HASH: 'test',
    ISOLATED_TEST_BUILD_ID: 'manual-123-1',
    ISOLATED_TEST_BACKEND_SHA: 'a'.repeat(40),
  },
}));

let directory: string;
let server: net.Server | undefined;
let profile: import('../../../../main/isolated-test-profile').IsolatedTestProfile;
let env: NodeJS.ProcessEnv;
let sidecar: typeof import('../intentd-sidecar');
beforeEach(async () => {
  vi.resetModules();
  spawn.mockReset();
  directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ip-')));
  const policy = await import('../../../../main/isolated-test-profile');
  profile = policy.prepareIsolatedTestProfile(directory, 'manual-123-1', 'a'.repeat(40));
  policy.activateIsolatedTestProfile(profile);
  env = policy.isolatedTestEnvironment(profile, { PATH: '/usr/bin' });
  sidecar = await import('../intentd-sidecar');
  sidecar.__setSidecarPrioritySetterForTesting(() => {});
});
afterEach(async () => {
  await sidecar?.stopIntentdSidecar();
  sidecar?.__resetIntentdSidecarForTesting();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  fs.rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('actual isolated package consumers', () => {
  it('rejects changed transport, binary and private bindings before command or connection work', async () => {
    const { resolveBackendConfig, createBackendSocket } = await import('../backend-connection');
    expect(() => createBackendSocket({ transport: 'uds', socketPath: '/normal/socket' })).toThrow(
      'private daemon',
    );
    expect(() => createBackendSocket({ transport: 'ws', wsUrl: 'ws://normal' })).toThrow(
      'private daemon',
    );
    expect(resolveBackendConfig(env, { platform: 'darwin' })).toEqual({
      transport: 'uds',
      socketPath: profile.socket,
    });
    for (const override of [
      { INTENTD_SOCKET: '/normal/socket' },
      { INTENTD_WS_URL: 'ws://normal' },
      { INTENTD_TCP: 'normal:123' },
      { INTENTD_BIN: '/normal/binary' },
      { INTENTD_DATA_DIR: '/normal/data' },
      { INTENTD_CONFIG: '/normal/config' },
    ]) {
      const changed = { ...env, ...override };
      expect(() => resolveBackendConfig(changed)).toThrow('Isolated test');
      await expect(
        sidecar.startIntentdSidecar(changed, true, directory, directory),
      ).rejects.toThrow('Isolated test');
      expect(() => sidecar.spawnSidecarOnDemand(changed, true, directory, directory)).toThrow(
        'Isolated test',
      );
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it('refuses an independently serving private socket at both startup and recovery', async () => {
    server = net.createServer((socket) =>
      socket.on('data', (data) => {
        const request = JSON.parse(data.toString());
        socket.write(
          JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { version: 'test' } }) + '\n',
        );
      }),
    );
    await new Promise<void>((resolve) => server!.listen(profile.socket, resolve));
    await expect(sidecar.startIntentdSidecar(env, true, directory, directory)).rejects.toThrow(
      'refusing daemon adoption',
    );
    await expect(
      sidecar.spawnSidecarOnDemand(env, true, directory, directory),
    ).resolves.toMatchObject({ ok: false, spawned: false });
    expect(spawn).not.toHaveBeenCalled();
    expect(server.listening).toBe(true);
  });

  it('keeps startup, owned stop and on-demand recovery on the same private bundle and environment', async () => {
    expect(vi.isMockFunction((await import('node:child_process')).spawn)).toBe(true);
    const binary = path.join(directory, 'intentd', 'intentd');
    fs.mkdirSync(path.dirname(binary));
    fs.writeFileSync(binary, 'unit fixture: never executed');
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), {
        pid: 987654321,
        exitCode: null as number | null,
        killed: false,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      child.kill.mockImplementation(() => {
        child.killed = true;
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit('exit', 0, null);
        });
        return true;
      });
      return child;
    });
    await sidecar.startIntentdSidecar(env, true, directory, directory);
    await sidecar.stopIntentdSidecar();
    expect(sidecar.getSidecarRunLog()).toMatchObject({ exitCode: 0, signal: null });
    await expect(
      sidecar.spawnSidecarOnDemand(env, true, directory, directory),
    ).resolves.toMatchObject({ ok: true, spawned: true });
    expect(spawn).toHaveBeenCalledTimes(2);
    for (const [executable, args, options] of spawn.mock.calls) {
      expect(executable).toBe(binary);
      expect(args).toEqual(['serve']);
      expect(options.env.INTENTD_DATA_DIR).toBe(profile.data);
      expect(options.env.INTENTD_CONFIG).toBe(profile.config);
      expect(options.env.HOME).toBe(profile.home);
      expect(options.detached).toBe(false);
    }
  });

  it('disables shared Keychain calls even when a helper path and macOS are explicitly supplied', async () => {
    const { createHelperKeychainClient } = await import('../keychain-sync');
    const client = createHelperKeychainClient({ platform: 'darwin', helperPath: '/normal/helper' });
    await expect(client.list()).resolves.toMatchObject({ ok: false, code: 'helper-missing' });
    const { isKeychainSyncEnabled } = await import('../keychain-sync-lifecycle');
    expect(await isKeychainSyncEnabled('darwin')).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('keeps automatic and explicit application updates disabled', async () => {
    const { autoUpdateService } = await import('../../../auto-update/main/auto-update.service');
    await autoUpdateService.initialize();
    expect(autoUpdateService.getState().channel).toBe('disabled');
    for (const operation of [
      () => autoUpdateService.setChannel('stable'),
      () => autoUpdateService.checkForUpdatesManual(),
      () => autoUpdateService.downloadUpdate(),
      () => autoUpdateService.installUpdate(),
    ])
      await expect(operation()).rejects.toThrow('disabled');
    autoUpdateService.cleanup();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });
});
