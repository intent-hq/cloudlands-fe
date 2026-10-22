// @vitest-environment node
// @verify-changed-triggers: electron-builder.yml, scripts/windows-authenticode.ps1
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  expectedWindowsArtifacts,
  verifyWindowsArtifacts,
  verifyNativeSignature,
} from './verify-windows-artifacts.cjs';

const require = createRequire(import.meta.url);
const { load, dump } = require('js-yaml');
const builderRequire = createRequire(require.resolve('electron-builder'));
const { buildBlockMap } = builderRequire('app-builder-lib/out/targets/blockmap/blockmap');
const config = load(readFileSync('electron-builder.yml', 'utf8'));
const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })),
);
const identity = {
  publisherName: 'Fixture Publisher',
  subject: 'CN=Fixture Publisher, O=Fixture Corporation, C=US',
};
const valid = {
  status: 'Valid',
  subject: identity.subject,
  publisherName: identity.publisherName,
  timestampSubject: 'CN=Fixture Timestamp',
  timestampThumbprint: 'ABCD',
  signerThumbprint: '1234',
};

async function fixture(version = '2.192.0-manual.123') {
  const dir = mkdtempSync(join(tmpdir(), 'windows-artifacts-'));
  temporary.push(dir);
  const metadata = { version, name: 'intent' };
  const names = expectedWindowsArtifacts(config, metadata);
  function put(name: string, bytes: string | Buffer = 'fixture bytes') {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), bytes);
  }
  // Independent expected filename oracle, not copied from selection output.
  put(`Intent.Setup.${version}.exe`, Buffer.from('installer signed final fixture'));
  put(`Intent.${version}.exe`, 'portable signed final fixture');
  put('win-unpacked/Intent.exe');
  put('win-unpacked/resources/intentd/intentd.exe');
  put('win-unpacked/resources/tailcat/tailcat.exe');
  put('win-unpacked/resources/app-update.yml', dump({ publisherName: ['Clement Pang'] }));
  put('win-unpacked/resources/app.asar.unpacked/node_modules/node-pty/pty.node');
  const bytes = readFileSync(join(dir, names.installer));
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const feed = {
    version,
    path: names.installer,
    sha512,
    files: [{ url: names.installer, sha512, size: bytes.length }],
  };
  const writeFeed = () => put(names.feed, dump(feed));
  writeFeed();
  await buildBlockMap(join(dir, names.installer), 'gzip', join(dir, names.blockmap));
  return { dir, metadata, names, feed, put, writeFeed };
}

describe('Windows artifact verification', () => {
  it.each(['2.192.0', '2.192.0-manual.123', '2.192.0-alpha.2+fixture'])(
    'selects actual expanded names and feed for %s',
    async (version) => {
      const f = await fixture(version);
      const native = vi.fn();
      const report = await verifyWindowsArtifacts({
        ...f,
        config,
        signing: { mode: 'unsigned' },
        native,
      });
      expect(report.artifacts.map((a: { path: string }) => a.path)).toEqual([
        `Intent.Setup.${version}.exe`,
        `Intent.${version}.exe`,
      ]);
      expect(report.artifacts.every((a: { sha512: string }) => a.sha512.length === 88)).toBe(true);
      expect(report.inventory.map((a: { path: string }) => a.path)).toContain(
        'win-unpacked/resources/intentd/intentd.exe',
      );
      expect(report.inventory.some((a: { path: string }) => a.path.endsWith('pty.node'))).toBe(
        true,
      );
      expect(report.nativeAcceptance).toBe('pending');
      expect(native).not.toHaveBeenCalled();
    },
  );

  it.each([
    'top-hash',
    'entry-hash',
    'size',
    'version',
    'duplicate',
    'no-files',
    'portable-in-feed',
  ])('rejects feed %s mismatch independently', async (change) => {
    const f = await fixture();
    if (change === 'top-hash') f.feed.sha512 = 'wrong';
    if (change === 'entry-hash') f.feed.files[0].sha512 = 'wrong';
    if (change === 'size') f.feed.files[0].size++;
    if (change === 'version') f.feed.version = '2.192.1';
    if (change === 'duplicate') f.feed.files.push(f.feed.files[0]);
    if (change === 'no-files') f.feed.files = [];
    if (change === 'portable-in-feed') f.feed.files[0].url = f.names.portable;
    f.writeFeed();
    await expect(
      verifyWindowsArtifacts({ ...f, config, signing: { mode: 'unsigned' } }),
    ).rejects.toThrow(/feed/i);
  });

  it.each([
    '../escape.exe',
    'sub/file.exe',
    'C:\\escape.exe',
    '//host/file.exe',
    '%2e%2e.exe',
    'a.exe:stream',
    'a.exe?',
    'a.exe#',
    'a.exe\n',
    'a.exe.',
  ])('rejects malformed feed paths %j', async (path) => {
    const f = await fixture();
    f.feed.path = path;
    f.feed.files[0].url = path;
    f.writeFeed();
    await expect(
      verifyWindowsArtifacts({ ...f, config, signing: { mode: 'unsigned' } }),
    ).rejects.toThrow(/path|feed/i);
  });

  it.each(['missing', 'corrupt', 'stale', 'changed-installer'])(
    'rejects %s blockmap/bytes',
    async (change) => {
      const f = await fixture();
      if (change === 'missing') rmSync(join(f.dir, f.names.blockmap));
      if (change === 'corrupt') f.put(f.names.blockmap, 'not gzip');
      if (change === 'stale') {
        const data = JSON.parse(gunzipSync(readFileSync(join(f.dir, f.names.blockmap))).toString());
        data.files[0].checksums[0] = 'wrong';
        f.put(f.names.blockmap, gzipSync(JSON.stringify(data)));
      }
      if (change === 'changed-installer') f.put(f.names.installer, 'modified after signing');
      await expect(
        verifyWindowsArtifacts({ ...f, config, signing: { mode: 'unsigned' } }),
      ).rejects.toThrow();
    },
  );

  it.each(['portable', 'daemon', 'tailcat', 'extra-exe', 'symlink'])(
    'rejects missing or unsafe inventory: %s',
    async (change) => {
      const f = await fixture();
      if (change === 'portable') rmSync(join(f.dir, f.names.portable));
      if (change === 'daemon') rmSync(join(f.dir, 'win-unpacked/resources/intentd/intentd.exe'));
      if (change === 'tailcat') rmSync(join(f.dir, 'win-unpacked/resources/tailcat/tailcat.exe'));
      if (change === 'extra-exe') f.put('Intent.old.exe');
      if (change === 'symlink') {
        rmSync(join(f.dir, f.names.portable));
        symlinkSync(join(f.dir, f.names.installer), join(f.dir, f.names.portable));
      }
      await expect(
        verifyWindowsArtifacts({ ...f, config, signing: { mode: 'unsigned' } }),
      ).rejects.toThrow();
    },
  );

  it('requires our exact identity on both wrappers/main/daemon and inventories other native code', async () => {
    const f = await fixture();
    f.put(
      'win-unpacked/resources/app-update.yml',
      dump({ publisherName: [identity.publisherName] }),
    );
    const native = vi.fn(async (_path, expected) => (expected ? valid : { status: 'NotSigned' }));
    const report = await verifyWindowsArtifacts({
      ...f,
      config,
      signing: { mode: 'azure', identity },
      native,
    });
    expect(
      native.mock.calls.filter((call) => call[1]).map((call) => call[0].slice(f.dir.length + 1)),
    ).toEqual([
      f.names.installer,
      f.names.portable,
      'win-unpacked/Intent.exe',
      'win-unpacked/resources/intentd/intentd.exe',
    ]);
    expect(
      report.inventory.filter(
        (a: { signature: { status: string } }) => a.signature.status === 'NotSigned',
      ),
    ).toHaveLength(2);
    expect(report.nativeAcceptance).toBe('pending');
  });

  it('propagates native verifier failures', async () => {
    const f = await fixture();
    f.put(
      'win-unpacked/resources/app-update.yml',
      dump({ publisherName: [identity.publisherName] }),
    );
    await expect(
      verifyWindowsArtifacts({
        ...f,
        config,
        signing: { mode: 'azure', identity },
        native: async () => {
          throw new Error('native failed');
        },
      }),
    ).rejects.toThrow('native failed');
  });

  it('requires the installed uninstaller and checks its exact publisher when an installed tree is supplied', async () => {
    const f = await fixture();
    f.put(
      'win-unpacked/resources/app-update.yml',
      dump({ publisherName: [identity.publisherName] }),
    );
    f.put('installed/Intent.exe');
    f.put('installed/resources/intentd/intentd.exe');
    f.put('installed/resources/tailcat/tailcat.exe');
    f.put('installed/resources/app-update.yml', dump({ publisherName: [identity.publisherName] }));
    const options = {
      ...f,
      config,
      installedDir: join(f.dir, 'installed'),
      signing: { mode: 'azure', identity },
      native: vi.fn(async () => valid),
    };
    await expect(verifyWindowsArtifacts(options)).rejects.toThrow();
    f.put('installed/Uninstall Intent.exe');
    const report = await verifyWindowsArtifacts(options);
    expect(
      report.inventory.find((item: { path: string }) => item.path === 'Uninstall Intent.exe'),
    ).toMatchObject({ scope: 'installed', policy: 'publisher' });
    expect(
      options.native.mock.calls.some(
        (call) => call[0].endsWith('Uninstall Intent.exe') && call[1] === identity,
      ),
    ).toBe(true);
  });

  it.each(
    [null, ['Clement Pang'], [identity.publisherName, 'Unexpected Publisher']].map((publishers) => [
      publishers,
    ]),
  )('rejects an incorrect packaged Azure updater allowlist %j', async (publishers) => {
    const f = await fixture();
    f.put('win-unpacked/resources/app-update.yml', dump({ publisherName: publishers }));
    await expect(
      verifyWindowsArtifacts({
        ...f,
        config,
        signing: { mode: 'azure', identity },
        native: async () => valid,
      }),
    ).rejects.toThrow(/publisher/i);
  });

  it('runs the actual unsigned CLI on a complete fixture and writes a report without inspecting secrets', async () => {
    const metadata = JSON.parse(readFileSync('package.json', 'utf8'));
    const f = await fixture(metadata.version);
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-windows-artifacts.cjs', '--dir', f.dir],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_WINDOWS_SIGNING_MODE: 'unsigned',
          AZURE_CLIENT_SECRET: 'never-log-this',
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const report = readFileSync(join(f.dir, 'windows-verification.json'), 'utf8');
    expect(JSON.parse(report).artifacts).toHaveLength(2);
    expect(report + result.stdout + result.stderr).not.toContain('never-log-this');
  });

  it('CLI fails closed for incomplete artifacts without printing credential values', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/verify-windows-artifacts.cjs', '--dir', '/missing-fixture-dir'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          INTENT_WINDOWS_SIGNING_MODE: 'unsigned',
          AZURE_CLIENT_SECRET: 'never-log-this',
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Windows artifact verification failed');
    expect(result.stderr).not.toContain('never-log-this');
  });
});

describe('native signature boundary (mocked PowerShell and SignTool)', () => {
  function runFor(value: unknown = valid) {
    return vi.fn((command: string) => ({
      status: 0,
      stdout: command === 'powershell.exe' ? JSON.stringify(value) : '',
      stderr: '',
    }));
  }
  it('uses literal argument transport and requires trust, all signatures and timestamps', async () => {
    const run = runFor();
    await expect(
      verifyNativeSignature("C:\\a ' quoted\\Intent.exe", identity, { run, platform: 'win32' }),
    ).resolves.toEqual(valid);
    expect(run.mock.calls[1][1]).toEqual([
      'verify',
      '/pa',
      '/all',
      '/v',
      '/tw',
      "C:\\a ' quoted\\Intent.exe",
    ]);
  });
  it.each([
    { ...valid, status: 'HashMismatch' },
    { ...valid, status: 'NotSigned' },
    { ...valid, publisherName: 'Fixture Publisher impostor' },
    { ...valid, subject: 'CN=Fixture Publisher, O=Different Organization, C=US' },
    { ...valid, timestampSubject: null },
    { ...valid, timestampThumbprint: null },
    { ...valid, signerThumbprint: null },
    {},
    null,
    [valid],
  ])('rejects incomplete, invalid or wrong-identity results %#', async (signature) => {
    await expect(
      verifyNativeSignature('test.exe', identity, { run: runFor(signature), platform: 'win32' }),
    ).rejects.toThrow();
  });
  it.each([1, 2, null])('rejects native exit status %j (including warnings)', async (status) => {
    const run = runFor();
    run.mockImplementationOnce(() => ({ status, stdout: JSON.stringify(valid), stderr: '' }));
    await expect(
      verifyNativeSignature('test.exe', identity, { run, platform: 'win32' }),
    ).rejects.toThrow();
    const signtool = runFor();
    signtool.mockImplementationOnce(() => ({
      status: 0,
      stdout: JSON.stringify(valid),
      stderr: '',
    }));
    signtool.mockImplementationOnce(() => ({ status, stdout: '', stderr: '' }));
    await expect(
      verifyNativeSignature('test.exe', identity, { run: signtool, platform: 'win32' }),
    ).rejects.toThrow();
  });
  it('rejects missing commands, malformed JSON, unsupported hosts and bad vendor signatures', async () => {
    for (const result of [
      { error: new Error('ENOENT'), status: null },
      { status: 0, stdout: 'not-json' },
    ]) {
      await expect(
        verifyNativeSignature('test.exe', identity, { platform: 'win32', run: () => result }),
      ).rejects.toThrow();
    }
    await expect(
      verifyNativeSignature('test.exe', identity, { platform: 'linux' }),
    ).rejects.toThrow(/Windows/);
    await expect(
      verifyNativeSignature('vendor.dll', null, {
        platform: 'win32',
        run: runFor({ status: 'HashMismatch' }),
      }),
    ).rejects.toThrow();
    await expect(
      verifyNativeSignature('vendor.node', null, {
        platform: 'win32',
        run: runFor({ status: 'NotSigned' }),
      }),
    ).resolves.toEqual({ status: 'NotSigned' });
  });
});
