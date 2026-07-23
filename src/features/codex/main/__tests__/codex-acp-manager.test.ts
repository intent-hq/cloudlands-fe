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

const entryPackageName = '@agentclientprotocol/codex-acp';
const nativePackageNames: Record<PlatformKey, string> = {
  'darwin-arm64': '@openai/codex-darwin-arm64',
  'darwin-x64': '@openai/codex-darwin-x64',
  'linux-x64': '@openai/codex-linux-x64',
  'win32-x64': '@openai/codex-win32-x64',
};
const vendorTriples: Record<PlatformKey, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-x64': 'x86_64-pc-windows-msvc',
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
  it('pins the real dependency closure and supported native package integrities', async () => {
    const manager = await import('../codex-acp-manager');

    expect(manager.MANAGED_CODEX_ACP_VERSION).toBe('1.1.7');
    const entry = manager.MANAGED_CODEX_ACP_INTEGRITY.packages.find(
      (pkg) => pkg.packageName === entryPackageName,
    );
    expect(entry).toMatchObject({
      packageName: entryPackageName,
      integrity: 'sha512-bhFLbGtOMEw6+PAp33vNERb6dXlULOfV3mWbRdps4v7sY7PHha/C2T1dnlG0yVcvBu9W+NYPzL0CAupnVoFTiQ==',
    });
    // Runtime deps of the pure-Node adapter must be part of the staged closure.
    const packageNames = manager.MANAGED_CODEX_ACP_INTEGRITY.packages.map((pkg) => pkg.packageName);
    expect(packageNames).toEqual(expect.arrayContaining([
      '@agentclientprotocol/sdk',
      '@openai/codex',
      'diff',
      'open',
      'vscode-jsonrpc',
      'zod',
    ]));
    for (const pkg of [
      ...manager.MANAGED_CODEX_ACP_INTEGRITY.packages,
      ...Object.values(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms),
    ]) {
      expect(pkg.integrity).toMatch(/^sha512-/);
      expect(pkg.tarballUrl).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
    expect(Object.keys(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms).sort()).toEqual([
      'darwin-arm64',
      'darwin-x64',
      'linux-x64',
      'win32-x64',
    ]);
    const expectedPlatformIntegrities: Record<PlatformKey, string> = {
      'darwin-arm64':
        'sha512-h6aQ0UxnaP8mIM/9/qPAH9MNkRliJo88toq1T36IxNM2L5JSU0TFamu+MZn7YkFgDsrp0RfiI+97Tm8AVVxqtA==',
      'darwin-x64':
        'sha512-FCYzVKCa9VoLtg9gVyzKpqylonfgZrfcWZN6HsXAZPeuo8CukdMqdgTUOhDn2V6h3MbqS0z6VqQVKUllN/yKhA==',
      'linux-x64':
        'sha512-u8w8LLv3DvsfrDCoswLIemZ0SoNEXyi511WsfFsSiYUazk9qMsB/NtU8N9vhAfN7mZAxLFoMex4v66JjHuZWwA==',
      'win32-x64':
        'sha512-u0h9lk094CaXRSqE34SBW2dRaQTPa6fASXqehczWH9QdsU62mBsiAgAdp6tCG4i+YzPmmhjD8FdXNnYGNmwuMg==',
    };
    for (const key of Object.keys(nativePackageNames) as PlatformKey[]) {
      expect(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms[key].packageName).toBe(
        nativePackageNames[key],
      );
      expect(manager.MANAGED_CODEX_ACP_INTEGRITY.platforms[key].integrity).toBe(
        expectedPlatformIntegrities[key],
      );
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
    expect(mocks.httpsGet).toHaveBeenCalledTimes(3);
    expect(first.wrapperPath).toContain(
      path.join('runtimes', 'codex-acp', '1.1.7', 'node_modules', '@agentclientprotocol', 'codex-acp'),
    );
    await expect(fs.access(first.wrapperPath)).resolves.toBeUndefined();
    expect(mocks.backendRequest).toHaveBeenCalledWith(
      'host.exec',
      expect.objectContaining({
        command: process.execPath,
        args: [
          expect.stringContaining(path.join('codex-acp', 'dist', 'index.js')),
          '--version',
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
    mockDownloads(new Map([[fixtures.manifest.packages[0].tarballUrl, Buffer.from('wrong')]]));

    await expect(manager.ensureManagedCodexAcp()).rejects.toThrow('Integrity mismatch');

    const baseDir = path.join(mocks.userData, 'runtimes', 'codex-acp');
    const entries = await fs.readdir(baseDir).catch(() => []);
    expect(entries.filter((entry) => entry.startsWith('.tmp-'))).toEqual([]);
    expect(entries).not.toContain('1.1.7');
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
    expect(entries).toEqual(['0.12.0', '1.1.7']);
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
          return { stdout: '', stderr: 'TeamIdentifier=2DC432GLL2\n', exitCode: 0 };
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
        args: expect.arrayContaining(['--version']),
      }),
    );
  });
});

function createFixtures(platform: PlatformKey) {
  const nativeBinaryName = platform === 'win32-x64' ? 'codex.exe' : 'codex';
  const entryTarball = createTarGz({
    'package/dist/index.js': '#!/usr/bin/env node\nconsole.log("codex-acp 1.1.7")\n',
    'package/package.json': JSON.stringify({ name: entryPackageName }),
  });
  const depTarball = createTarGz({
    'package/index.js': 'module.exports = {}\n',
    'package/package.json': JSON.stringify({ name: 'zod' }),
  });
  const nativeTarball = createTarGz({
    [`package/vendor/${vendorTriples[platform]}/bin/${nativeBinaryName}`]: 'native-binary',
    'package/package.json': JSON.stringify({ name: nativePackageNames[platform] }),
  });
  const manifest = {
    packages: [
      {
        packageName: entryPackageName,
        tarballUrl: 'https://example.test/codex-acp.tgz',
        integrity: integrityFor(entryTarball),
      },
      {
        packageName: 'zod',
        tarballUrl: 'https://example.test/zod.tgz',
        integrity: integrityFor(depTarball),
      },
    ],
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
      [manifest.packages[0].tarballUrl, entryTarball],
      [manifest.packages[1].tarballUrl, depTarball],
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