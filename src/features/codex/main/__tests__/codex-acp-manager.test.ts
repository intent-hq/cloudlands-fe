import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { gzipSync } from 'zlib';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
  userData: '',
  httpsGet: vi.fn(),
  // AUDIT-R1b: codex-acp-manager's `runProcess` now routes through
  // `hostExec` -> `getBackendClient().request('host.exec', ...)`. The old
  // `child_process.spawn` mock is replaced with a backend-request mock so we
  // still capture invocations shape-for-shape (command / args / env /
  // timeoutMs) without going through spawn.
  backendRequest: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mocks.userData),
  },
}));

vi.mock('https', () => ({
  get: mocks.httpsGet,
  default: { get: mocks.httpsGet },
}));

vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: mocks.backendRequest }),
}));

type PlatformKey = 'darwin-arm64' | 'darwin-x64' | 'linux-x64' | 'win32-x64';

const wrapperPackageName = '@zed-industries/codex-acp';
const nativePackageNames: Record<PlatformKey, string> = {
  'darwin-arm64': '@zed-industries/codex-acp-darwin-arm64',
  'darwin-x64': '@zed-industries/codex-acp-darwin-x64',
  'linux-x64': '@zed-industries/codex-acp-linux-x64',
  'win32-x64': '@zed-industries/codex-acp-win32-x64',
};

let tempRoots: string[] = [];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-acp-manager-'));
  tempRoots.push(mocks.userData);
  // Default: any host.exec call succeeds with empty stdout / stderr.
  mocks.backendRequest.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 });
});

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => fs.rm(root, { recursive: true, force: true })));
  tempRoots = [];
});

describe('codex-acp-manager', () => {
  it('pins the real wrapper and supported native package integrities', async () => {
    const manager = await import('../codex-acp-manager');

    expect(manager.MANAGED_CODEX_ACP_VERSION).toBe('0.13.0');
    expect(manager.MANAGED_CODEX_ACP_INTEGRITY.wrapper).toMatchObject({
      packageName: wrapperPackageName,
      integrity: 'sha512-Ep3gINMVB8qQL3kozJxEzG4YP7NmWUb5s+8yu8tQ7YSPfaIPXBIQQmO5sQk2Uu2av+gIC2EchbwaSSG3Mo17YQ==',
    });
    expect(Object.keys(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'win32-x64',
    ]);
    for (const key of Object.keys(nativePackageNames) as PlatformKey[]) {
      expect(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms[key].packageName).toBe(
        nativePackageNames[key],
      );
      expect(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms[key].integrity).toMatch(/^sha512-/);
    }
  });

  it('installs the managed wrapper with a single shared download for concurrent calls', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('linux-x64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'linux',
      arch: 'x64',
      manifest: fixtures.manifest,
    });
    mockDownloads(fixtures.downloads);

    const [first, second] = await Promise.all([
      manager.ensureManagedCodexAcp(),
      manager.ensureManagedCodexAcp(),
    ]);

    expect(first).toEqual(second);
    expect(mocks.httpsGet).toHaveBeenCalledTimes(2);
    expect(first.wrapperPath).toContain(
      path.join('runtimes', 'codex-acp', '0.13.0', 'node_modules', '@zed-industries', 'codex-acp'),
    );
    await expect(fs.access(first.wrapperPath)).resolves.toBeUndefined();
    expect(mocks.backendRequest).toHaveBeenCalledWith(
      'host.exec',
      expect.objectContaining({
        command: process.execPath,
        args: [
          expect.stringContaining(path.join('codex-acp', 'bin', 'codex-acp.js')),
          '--help',
        ],
        env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
      }),
    );
    expect(manager.getManagedCodexAcpStatus()).toMatchObject({
      state: 'ready',
      wrapperPath: first.wrapperPath,
    });
  });

  it('rejects integrity mismatches and removes partial temp dirs', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('linux-x64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'linux',
      arch: 'x64',
      manifest: fixtures.manifest,
    });
    mockDownloads(new Map([[fixtures.manifest.wrapper.tarballUrl, Buffer.from('wrong')]]));

    await expect(manager.ensureManagedCodexAcp()).rejects.toThrow('Integrity mismatch');

    const baseDir = path.join(mocks.userData, 'runtimes', 'codex-acp');
    const entries = await fs.readdir(baseDir).catch(() => []);
    expect(entries.filter((entry) => entry.startsWith('.tmp-'))).toEqual([]);
    expect(entries).not.toContain('0.13.0');
  });

  it('cleans stale temp directories before installing', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('linux-x64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'linux',
      arch: 'x64',
      manifest: fixtures.manifest,
    });
    mockDownloads(fixtures.downloads);

    const baseDir = path.join(mocks.userData, 'runtimes', 'codex-acp');
    await fs.mkdir(path.join(baseDir, '.tmp-stale', 'nested'), { recursive: true });

    await manager.ensureManagedCodexAcp();

    const entries = await fs.readdir(baseDir);
    expect(entries).not.toContain('.tmp-stale');
  });

  it('keeps current and previous managed versions after a successful install', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('linux-x64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'linux',
      arch: 'x64',
      manifest: fixtures.manifest,
    });
    mockDownloads(fixtures.downloads);

    const baseDir = path.join(mocks.userData, 'runtimes', 'codex-acp');
    await fs.mkdir(path.join(baseDir, '0.11.0'), { recursive: true });
    await fs.mkdir(path.join(baseDir, '0.12.0'), { recursive: true });

    await manager.ensureManagedCodexAcp();

    const entries = (await fs.readdir(baseDir)).sort();
    expect(entries).toEqual(['0.12.0', '0.13.0']);
  });

  it('rejects unsupported platform and arch combinations without downloading', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('linux-x64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'linux',
      arch: 'arm64',
      manifest: fixtures.manifest,
    });

    expect(manager.getManagedCodexAcpStatus()).toMatchObject({ state: 'unsupported' });
    await expect(manager.ensureManagedCodexAcp()).rejects.toThrow('Unsupported platform/arch');
    expect(mocks.httpsGet).not.toHaveBeenCalled();
  });

  it('verifies macOS native binary signature and Team ID before validation', async () => {
    const manager = await import('../codex-acp-manager');
    const fixtures = createFixtures('darwin-arm64');
    manager.__managedCodexAcpTestUtils.setOverrides({
      platform: 'darwin',
      arch: 'arm64',
      manifest: fixtures.manifest,
    });
    mockDownloads(fixtures.downloads);
    mocks.backendRequest.mockImplementation(
      async (_method: string, params: { command: string; args?: string[] }) => {
        if (params.command === 'codesign' && params.args?.[0] === '-dv') {
          return { stdout: '', stderr: 'TeamIdentifier=MQ55VZLNZQ\n', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    );

    await manager.ensureManagedCodexAcp();

    expect(mocks.backendRequest).toHaveBeenNthCalledWith(
      1,
      'host.exec',
      expect.objectContaining({
        command: 'codesign',
        args: expect.arrayContaining(['--verify', '--deep', '--strict']),
      }),
    );
    expect(mocks.backendRequest).toHaveBeenNthCalledWith(
      2,
      'host.exec',
      expect.objectContaining({
        command: 'codesign',
        args: expect.arrayContaining(['-dv', '--verbose=2']),
      }),
    );
    expect(mocks.backendRequest).toHaveBeenNthCalledWith(
      3,
      'host.exec',
      expect.objectContaining({
        command: process.execPath,
        args: expect.arrayContaining(['--help']),
      }),
    );
  });
});

function createFixtures(platform: PlatformKey) {
  const nativeBinaryName = platform === 'win32-x64' ? 'codex-acp.exe' : 'codex-acp';
  const wrapperTarball = createTarGz({
    'package/bin/codex-acp.js': '#!/usr/bin/env node\nconsole.log("codex-acp help")\n',
    'package/package.json': JSON.stringify({ name: wrapperPackageName }),
  });
  const nativeTarball = createTarGz({
    [`package/bin/${nativeBinaryName}`]: 'native-binary',
    'package/package.json': JSON.stringify({ name: nativePackageNames[platform] }),
  });
  const manifest = {
    wrapper: {
      packageName: wrapperPackageName,
      tarballUrl: 'https://example.test/codex-acp.tgz',
      integrity: integrityFor(wrapperTarball),
    },
    platforms: Object.fromEntries(
      (Object.keys(nativePackageNames) as PlatformKey[]).map((key) => [
        key,
        {
          packageName: nativePackageNames[key],
          tarballUrl: `https://example.test/${key}.tgz`,
          integrity: integrityFor(nativeTarball),
        },
      ]),
    ),
  } as any;
  return {
    manifest,
    downloads: new Map<string, Buffer>([
      [manifest.wrapper.tarballUrl, wrapperTarball],
      [manifest.platforms[platform].tarballUrl, nativeTarball],
    ]),
  };
}

function mockDownloads(downloads: Map<string, Buffer>): void {
  mocks.httpsGet.mockImplementation((url: string, callback: (response: Readable) => void) => {
    const body = downloads.get(url);
    if (!body) throw new Error(`Unexpected download URL: ${url}`);
    const response = Readable.from([body]) as Readable & {
      statusCode: number;
      headers: Record<string, string>;
      resume: () => void;
    };
    response.statusCode = 200;
    response.headers = {};
    setImmediate(() => callback(response));

    const request = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, callback: () => void) => void;
      destroy: (error?: Error) => void;
    };
    request.setTimeout = vi.fn();
    request.destroy = vi.fn((error?: Error) => {
      if (error) request.emit('error', error);
    });
    return request;
  });
}

function integrityFor(buffer: Buffer): string {
  return `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
}

function createTarGz(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512, 0);
    writeString(header, name, 0, 100);
    writeOctal(header, 0o644, 100, 8);
    writeOctal(header, 0, 108, 8);
    writeOctal(header, 0, 116, 8);
    writeOctal(header, data.length, 124, 12);
    writeOctal(header, 0, 136, 12);
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    writeString(header, 'ustar', 257, 6);
    writeString(header, '00', 263, 2);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeOctal(header, checksum, 148, 8);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512, 0));
  }
  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks));
}

function writeString(buffer: Buffer, value: string, offset: number, length: number): void {
  buffer.write(value.slice(0, length), offset, length, 'utf8');
}

function writeOctal(buffer: Buffer, value: number, offset: number, length: number): void {
  const octal = value.toString(8).padStart(length - 1, '0');
  buffer.write(octal, offset, length - 1, 'ascii');
  buffer[offset + length - 1] = 0;
}