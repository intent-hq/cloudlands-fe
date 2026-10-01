// @vitest-environment node
// @verify-changed-triggers: electron-builder.yml, scripts/windows-builder.cjs, scripts/windows-sign.cjs, .github/workflows/intent-manual-windows-build.yml, .github/workflows/manual-signed-build.yml
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { resolveWindowsSigning, manualWindowsConfig } from './windows-signing.cjs';

const require = createRequire(import.meta.url);
vi.stubEnv('JITI_FS_CACHE', 'false');
afterAll(() => vi.unstubAllEnvs());
require('electron-builder');
const builderRequire = createRequire(require.resolve('electron-builder'));
const { WinPackager } = builderRequire('app-builder-lib/out/winPackager');
const { WindowsSignAzureManager } = builderRequire(
  'app-builder-lib/out/codeSign/windowsSignAzureManager',
);
const { getConfig, validateConfiguration } = builderRequire(
  'app-builder-lib/out/util/config/config',
);
const { load } = require('js-yaml');
const base = load(readFileSync('electron-builder.yml', 'utf8'));

// Entirely fictional test identity, never a production default.
const azureEnv = {
  INTENT_WINDOWS_AZURE_ENDPOINT: 'https://eus.codesigning.azure.net/',
  INTENT_WINDOWS_AZURE_ACCOUNT_NAME: 'fixture-account',
  INTENT_WINDOWS_AZURE_CERTIFICATE_PROFILE_NAME: 'fixture-profile',
  INTENT_WINDOWS_PUBLISHER_NAME: 'Fixture Publisher',
  INTENT_WINDOWS_PUBLISHER_SUBJECT: 'CN=Fixture Publisher, O=Fixture Corporation, C=US',
  AZURE_TENANT_ID: '11111111-1111-1111-1111-111111111111',
  AZURE_CLIENT_ID: '22222222-2222-2222-2222-222222222222',
  AZURE_CLIENT_SECRET: 'fixture-secret-never-log',
};

describe('Windows signing configuration', () => {
  it.each(['unsigned', 'azure'])(
    'loads the actual manual builder entry in %s mode',
    async (mode) => {
      vi.stubEnv('INTENT_WINDOWS_SIGNING_MODE', mode);
      for (const [name, value] of Object.entries(azureEnv)) vi.stubEnv(name, value);
      const config = await getConfig(process.cwd(), 'scripts/windows-builder.cjs');
      await validateConfiguration(config, { debug() {} });
      expect(config.win.signExecutable).toBe(mode === 'azure');
      expect(config.win.azureSignOptions?.publisherName).toBe(
        mode === 'azure' ? 'Fixture Publisher' : undefined,
      );
      expect(config.win.signtoolOptions?.publisherName).toBe(
        mode === 'unsigned' ? 'Clement Pang' : undefined,
      );
      expect(JSON.stringify(config)).not.toContain(azureEnv.AZURE_CLIENT_SECRET);
    },
  );
  it('defaults to unsigned without reading credentials or changing the installed publisher', async () => {
    const env = new Proxy(
      {},
      {
        get() {
          throw new Error('credential access');
        },
      },
    );
    const resolved = resolveWindowsSigning(undefined, env);
    const config = manualWindowsConfig(base, resolved);
    expect(config.win.azureSignOptions).toBeUndefined();
    expect(config.win.signtoolOptions.publisherName).toBe('Clement Pang');
    expect(config.win.signExecutable).toBe(false);
    expect(config.win.verifyUpdateCodeSignature).toBe(true);
    await validateConfiguration(config, { debug() {} });
  });

  it.each(['', 'true', 'digicert', 'Azure'])('rejects an ambiguous mode %j', (mode) => {
    expect(() => resolveWindowsSigning(mode, azureEnv)).toThrow(/mode/);
  });

  it.each(Object.keys(azureEnv))('fails clearly when %s is absent or blank', (key) => {
    for (const value of [undefined, '', '   ']) {
      expect(() => resolveWindowsSigning('azure', { ...azureEnv, [key]: value })).toThrow(key);
    }
  });

  it.each([
    ['INTENT_WINDOWS_AZURE_ENDPOINT', 'http://eus.codesigning.azure.net'],
    ['INTENT_WINDOWS_AZURE_ENDPOINT', 'https://user:password@eus.codesigning.azure.net/'],
    ['INTENT_WINDOWS_AZURE_ENDPOINT', 'https://example.com/'],
    ['INTENT_WINDOWS_AZURE_ACCOUNT_NAME', 'bad\naccount'],
    ['AZURE_CLIENT_ID', 'not-a-guid'],
  ])('rejects invalid %s without exposing the input', (key, value) => {
    expect(() => resolveWindowsSigning('azure', { ...azureEnv, [key]: value })).toThrow(key);
    try {
      resolveWindowsSigning('azure', { ...azureEnv, [key]: value });
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });

  it('uses only the native Azure provider and supported pinned-builder fields', async () => {
    const resolved = resolveWindowsSigning('azure', azureEnv);
    const config = manualWindowsConfig(base, resolved);
    expect(config.win.signtoolOptions).toBeUndefined();
    expect(config.win.azureSignOptions).toEqual({
      publisherName: 'Fixture Publisher',
      endpoint: 'https://eus.codesigning.azure.net/',
      codeSigningAccountName: 'fixture-account',
      certificateProfileName: 'fixture-profile',
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    });
    expect(config.forceCodeSigning).toBe(true);
    expect(JSON.stringify(resolved)).not.toContain(azureEnv.AZURE_CLIENT_SECRET);
    expect(base.win.signtoolOptions.publisherName).toBe('Clement Pang');
    await validateConfiguration(config, { debug() {} });
    // Executes the pinned builder's selection, replacing the legacy hook's
    // Setup/direct-child heuristic. Native signing is not invoked here.
    for (const file of [
      'Intent.exe',
      'Intent.2.192.0-manual.123.exe',
      'resources/intentd/intentd.exe',
      'Intent.Setup.2.192.0.__uninstaller.exe',
    ]) {
      expect(
        WinPackager.prototype.shouldSignFile.call(
          { platformSpecificBuildOptions: config.win },
          file,
        ),
      ).toBe(true);
    }
    expect(config.win.signExts).toBeUndefined(); // no unreviewed DLL/vendor re-signing
  });

  it('verifies artifacts using public identity alone, without reading signing credentials', () => {
    const env = new Proxy(azureEnv, {
      get(target, key) {
        if (String(key).startsWith('AZURE_')) throw new Error('credential access');
        return target[key as keyof typeof azureEnv];
      },
    });
    expect(resolveWindowsSigning('azure', env, { credentials: false }).identity.subject).toBe(
      azureEnv.INTENT_WINDOWS_PUBLISHER_SUBJECT,
    );
  });

  it('propagates a native Azure signer failure instead of accepting an unsigned result', async () => {
    const config = manualWindowsConfig(base, resolveWindowsSigning('azure', azureEnv));
    const exec = vi.fn(async () => {
      throw new Error('mock native signer failed');
    });
    const manager = new WindowsSignAzureManager({
      platformSpecificBuildOptions: config.win,
      vm: {
        value: Promise.resolve({
          powershellCommand: { value: Promise.resolve('powershell.exe') },
          toVmFile: (path: string) => path,
          exec,
        }),
      },
    });
    await expect(
      manager.signFile({ path: 'Intent.fixture.exe', options: config.win }),
    ).rejects.toThrow('mock native signer failed');
    expect(exec).toHaveBeenCalledOnce();
    expect(JSON.stringify(exec.mock.calls)).not.toContain(azureEnv.AZURE_CLIENT_SECRET);
  });

  it('keeps old-client publisher rejection visible instead of weakening the updater allowlist', async () => {
    const file = require.resolve('electron-updater/out/windowsExecutableCodeSignatureVerifier');
    const updaterRequire = createRequire(file);
    const context = {
      exports: {} as {
        verifySignature: (
          publishers: string[],
          path: string,
          logger: unknown,
        ) => Promise<string | null>;
      },
      require(id: string) {
        if (id === 'child_process')
          return {
            execFile(...args: unknown[]) {
              const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
              callback(
                null,
                JSON.stringify({
                  Status: 0,
                  SignerCertificate: { Subject: azureEnv.INTENT_WINDOWS_PUBLISHER_SUBJECT },
                }),
                '',
              );
            },
          };
        return updaterRequire(id);
      },
    };
    runInNewContext(readFileSync(file, 'utf8'), context);
    const logger = { info() {}, warn() {}, error() {} };
    const unsigned = manualWindowsConfig(base, resolveWindowsSigning('unsigned'));
    const signed = manualWindowsConfig(base, resolveWindowsSigning('azure', azureEnv));
    expect(
      await context.exports.verifySignature(
        [unsigned.win.signtoolOptions.publisherName],
        'fixture.exe',
        logger,
      ),
    ).not.toBeNull();
    expect(
      await context.exports.verifySignature(
        [signed.win.azureSignOptions.publisherName],
        'fixture.exe',
        logger,
      ),
    ).toBeNull();
  });
});
