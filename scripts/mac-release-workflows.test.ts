// @verify-changed-triggers: .github/workflows/release-alpha.yml, .github/workflows/manual-signed-build.yml, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml, scripts/assemble-release-assets.mjs, scripts/verify-macos-build.sh, scripts/mac-update-feed.mjs
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const updaterRequire = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load, dump } = updaterRequire('js-yaml');
interface Step {
  name: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Matrix {
  arch: string;
  label: string;
  runner: string;
  intentd_target: string;
}
interface Job {
  steps: Step[];
  strategy?: { matrix: { include: Matrix[] } };
  env?: Record<string, string>;
}
interface Workflow {
  jobs: Record<string, Job>;
}
const workflow = (name: string): Workflow =>
  load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const step = (name: string, job: string, label: string) => {
  const found = workflow(name).jobs[job].steps.find((s) => s.name === label);
  if (!found) throw new Error(`Missing ${name}/${job}/${label}`);
  return found;
};
const dirs: string[] = [];
function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'mac-release-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'scripts'));
  for (const file of [
    'assemble-release-assets.mjs',
    'mac-update-feed.mjs',
    'validate-release-asset-names.mjs',
    'verify-macos-build.sh',
    'macos-native.cjs',
  ])
    copyFileSync(resolve('scripts', file), join(dir, 'scripts', file));
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function stub(dir: string, name: string, shell: string) {
  writeFileSync(join(dir, 'bin', name), `#!/bin/bash\n${shell}\n`, { mode: 0o755 });
}
function shell(dir: string, code: string, env: Record<string, string> = {}) {
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', code], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      RUNNER_TEMP: dir,
      ...env,
    },
  });
}
function render(value: string, context: Record<string, string>) {
  return value.replace(/\$\{\{\s*(.*?)\s*\}\}/g, (_, key) => {
    if (!(key in context)) throw new Error(`Unresolved workflow expression: ${key}`);
    return context[key];
  });
}
function fixtures(dir: string) {
  const downloads = join(dir, 'release-downloads');
  mkdirSync(downloads);
  for (const arch of ['x64', 'arm64']) {
    const job = join(downloads, `release-macos-${arch}`);
    mkdirSync(job);
    const files = [`Intent-1.2.3-${arch}-mac.zip`, `Intent-1.2.3-${arch}.dmg`].map((url) => {
      const bytes = Buffer.from(`independent archive payload ${url}`);
      writeFileSync(join(job, url), bytes);
      writeFileSync(join(job, `${url}.blockmap`), `blockmap ${url}`);
      return {
        url,
        size: bytes.length,
        sha512: createHash('sha512').update(bytes).digest('base64'),
      };
    });
    writeFileSync(
      join(job, 'latest-mac.yml'),
      dump({ version: '1.2.3', files, path: files[0].url, sha512: files[0].sha512 }),
    );
  }
  for (const [job, feed, asset] of [
    ['release-windows', 'latest.yml', 'Intent.Setup.1.2.3.exe'],
    ['release-linux-x64', 'latest-linux.yml', 'Intent-1.2.3.AppImage'],
    ['release-linux-arm64', 'latest-linux-arm64.yml', 'Intent-1.2.3-arm64.AppImage'],
  ]) {
    mkdirSync(join(downloads, job));
    writeFileSync(join(downloads, job, feed), 'version: 1.2.3\n');
    writeFileSync(join(downloads, job, asset), `${job} payload`);
  }
  return downloads;
}
const assemble = (dir: string, version = '1.2.3') =>
  shell(dir, step('release-alpha', 'publish', 'Assemble release assets').run!, {
    VERSION: version,
  });

describe('release artifact assembly through the publish workflow', () => {
  it('preserves both Mac archives and blockmaps, other platforms, and a single usable feed', () => {
    const dir = temp();
    fixtures(dir);
    const result = assemble(dir);
    expect(result.status, result.stderr).toBe(0);
    const output = join(dir, 'dist-electron');
    const feed = load(readFileSync(join(output, 'latest-mac.yml'), 'utf8'));
    expect(feed.files.map((f: { url: string }) => f.url)).toEqual([
      'Intent-1.2.3-x64-mac.zip',
      'Intent-1.2.3-x64.dmg',
      'Intent-1.2.3-arm64-mac.zip',
      'Intent-1.2.3-arm64.dmg',
    ]);
    for (const f of feed.files) {
      const bytes = readFileSync(join(output, f.url));
      expect(createHash('sha512').update(bytes).digest('base64')).toBe(f.sha512);
      expect(readFileSync(join(output, `${f.url}.blockmap`), 'utf8')).toBe(`blockmap ${f.url}`);
    }
    expect(feed.path).toBe('Intent-1.2.3-x64-mac.zip');
    expect(readFileSync(join(output, 'Intent.Setup.1.2.3.exe'), 'utf8')).toBe(
      'release-windows payload',
    );
    expect(readdirSync(output)).toHaveLength(15);
    expect(existsSync(join(dir, 'release-downloads/release-macos-arm64/latest-mac.yml'))).toBe(
      true,
    );
  });
  it.each([
    'missing Intel',
    'missing DMG',
    'missing ZIP',
    'corrupt archive',
    'wrong version',
    'collision',
    'symlink',
    'missing Linux feed',
  ])('rejects %s before anything can be published', (failure) => {
    const dir = temp();
    const downloads = fixtures(dir);
    const intel = join(downloads, 'release-macos-x64');
    if (failure === 'missing Intel') rmSync(intel, { recursive: true });
    if (failure === 'missing DMG' || failure === 'missing ZIP') {
      const path = join(intel, 'latest-mac.yml');
      const feed = load(readFileSync(path, 'utf8'));
      feed.files = feed.files.filter(
        (f: { url: string }) => !f.url.endsWith(failure === 'missing DMG' ? '.dmg' : '.zip'),
      );
      delete feed.path;
      delete feed.sha512;
      writeFileSync(path, dump(feed));
    }
    if (failure === 'corrupt archive')
      writeFileSync(join(intel, 'Intent-1.2.3-x64-mac.zip'), 'corrupted');
    if (failure === 'collision')
      writeFileSync(join(downloads, 'release-windows/Intent-1.2.3-x64.dmg'), 'overwritten');
    if (failure === 'symlink') symlinkSync('/dev/null', join(intel, 'extra.blockmap'));
    if (failure === 'missing Linux feed')
      rmSync(join(downloads, 'release-linux-arm64/latest-linux-arm64.yml'));
    const result = assemble(dir, failure === 'wrong version' ? '9.9.9' : '1.2.3');
    expect(result.status, result.stdout).not.toBe(0);
    expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
  });
  it('refuses existing output without deleting it', () => {
    const dir = temp();
    fixtures(dir);
    mkdirSync(join(dir, 'dist-electron'));
    writeFileSync(join(dir, 'dist-electron/keep'), 'existing build');
    expect(assemble(dir).status).not.toBe(0);
    expect(readFileSync(join(dir, 'dist-electron/keep'), 'utf8')).toBe('existing build');
  });
});

describe.each(['release-alpha', 'manual-signed-build'])('%s native Mac jobs', (name) => {
  it('uses native runner and sidecar targets and invokes packaging for each CPU', () => {
    const job = workflow(name).jobs['build-macos'];
    const matrix = job.strategy!.matrix.include;
    expect(matrix.map((m) => [m.arch, m.runner, m.intentd_target])).toEqual([
      ['arm64', 'macos-15-xlarge', 'aarch64-apple-darwin'],
      ['x64', 'macos-15-large', 'x86_64-apple-darwin'],
    ]);
    for (const row of matrix) {
      const dir = temp();
      stub(
        dir,
        'pnpm',
        'printf "%s\\n" "$@" > "$RUNNER_TEMP/args"\nprintf "%s" "${CSC_LINK-unset}" > "$RUNNER_TEMP/cert"',
      );
      const run = step(name, 'build-macos', 'Build and package macOS app');
      const result = shell(
        dir,
        render(run.run!, { 'matrix.arch': row.arch, 'inputs.sign': 'true' }),
        { CSC_LINK: 'test-certificate' },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(dir, 'args'), 'utf8').trim().split('\n')).toEqual([
        'run',
        'dist:mac',
        `--${row.arch}`,
        '--publish',
        'never',
      ]);
      expect(readFileSync(join(dir, 'cert'), 'utf8')).toBe('test-certificate');
      expect(run.env?.REQUIRE_SHARED_KEYCHAIN_GROUP).toBe(
        name === 'release-alpha' ? '1' : "${{ inputs.sign && '1' || '' }}",
      );
    }
  });
  it('always removes signing material and restores the original keychain list', () => {
    const dir = temp();
    for (const file of [
      'certificate.p12',
      'keychain-helper.provisionprofile',
      'app-signing.keychain-db',
    ])
      writeFileSync(join(dir, file), 'secret');
    writeFileSync(
      join(dir, 'keychain-list.orig'),
      '/custom/a.keychain-db\n/custom/space name.keychain-db\n',
    );
    stub(
      dir,
      'security',
      'printf "%s\\n" "$@" >> "$RUNNER_TEMP/security-log"\nif [ "$1" = delete-keychain ]; then rm -f "$2"; fi',
    );
    const cleanup = step(name, 'build-macos', 'Clean up signing keychain');
    expect(cleanup.if).toBe('always()');
    expect(shell(dir, cleanup.run!).status).toBe(0);
    for (const file of [
      'certificate.p12',
      'keychain-helper.provisionprofile',
      'app-signing.keychain-db',
    ])
      expect(existsSync(join(dir, file))).toBe(false);
    expect(readFileSync(join(dir, 'security-log'), 'utf8').split('\n')).toContain(
      '/custom/space name.keychain-db',
    );
  });
});

describe.each(['beta', 'stable'])('%s promotion', (channel) => {
  const name = channel === 'beta' ? 'promote-beta' : 'release-stable';
  it('uploads both CPUs and blockmaps before replacing the combined feed', () => {
    const dir = temp();
    fixtures(dir);
    expect(assemble(dir).status).toBe(0);
    symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
    stub(dir, 'gh', 'printf "%s\\n" "$*" >> "$RUNNER_TEMP/uploads"');
    const result = shell(
      dir,
      step(name, `promote-to-${channel}`, `Upload new assets to ${channel}`).run!,
      { VERSION: '1.2.3', GITHUB_OUTPUT: join(dir, 'outputs') },
    );
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(join(dir, 'uploads'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    for (const arch of ['x64', 'arm64']) {
      expect(calls[0]).toContain(`Intent-1.2.3-${arch}-mac.zip`);
      expect(calls[0]).toContain(`Intent-1.2.3-${arch}.dmg.blockmap`);
    }
    expect(calls[0]).not.toContain('latest-mac.yml');
    expect(calls[1]).toContain('latest-mac.yml');
  });
  it.each([false, true])('compares the whole feed with changed ARM metadata=%s', (corrupt) => {
    const dir = temp();
    const original =
      'version: 1.2.3\nsha512: unchanged-intel-hash\nfiles:\n  - url: Intent-arm64-mac.zip\n    sha512: arm-hash\n';
    writeFileSync(join(dir, 'versioned.yml'), original);
    writeFileSync(
      join(dir, 'channel.yml'),
      corrupt ? original.replace('arm-hash', 'corrupt-arm-hash') : original,
    );
    stub(
      dir,
      'curl',
      'case "$*" in */download/v*) cat "$RUNNER_TEMP/versioned.yml" ;; *) cat "$RUNNER_TEMP/channel.yml" ;; esac',
    );
    stub(dir, 'sleep', 'exit 0');
    const result = shell(
      dir,
      step(name, `promote-to-${channel}`, `Verify ${channel} feeds match versioned release`).run!,
      { VERSION: '1.2.3', PROMOTED_FEEDS: 'latest-mac.yml' },
    );
    if (corrupt) {
      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain('feed digest mismatch');
    } else expect(result.status, result.stderr).toBe(0);
  });
});

describe('packaged Mac verification invoked by native workflows', () => {
  function appFixture(dir: string, arch: string) {
    const app = join(dir, `dist-electron/mac-${arch}/Intent.app`);
    const binary = readFileSync(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`);
    for (const path of [
      'Contents/MacOS/Intent',
      'Contents/Resources/intentd/intentd',
      'Contents/Resources/speech-helper/intent-speech-helper',
      'Contents/Resources/keychain-helper/intent-keychain-helper.app/Contents/MacOS/intent-keychain-helper',
      'Contents/Resources/tailcat/tailcat',
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/pty.node',
      'Contents/Resources/app.asar.unpacked/node_modules/node-pty/build/Release/spawn-helper',
    ]) {
      mkdirSync(dirname(join(app, path)), { recursive: true });
      writeFileSync(join(app, path), binary);
    }
    for (const suffix of [`${arch}.dmg`, `${arch}-mac.zip`])
      writeFileSync(join(dir, `dist-electron/Intent-1.2.3-${suffix}`), 'archive');
    for (const command of ['codesign', 'spctl', 'xcrun'])
      stub(
        dir,
        command,
        `printf '%s\\n' '${command}' >> "$RUNNER_TEMP/verification"\nif [ "$FAIL_TOOL" = '${command}' ]; then exit 42; fi`,
      );
    return app;
  }
  it.each(['x64', 'arm64'])(
    'checks real %s payload headers and calls signing/notarization verification',
    (arch) => {
      const dir = temp();
      appFixture(dir, arch);
      const code = render(step('release-alpha', 'build-macos', 'Verify packaged Mac build').run!, {
        'matrix.arch': arch,
      });
      const result = shell(dir, code);
      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(join(dir, 'verification'), 'utf8').trim().split('\n')).toEqual([
        'codesign',
        'codesign',
        'spctl',
        'xcrun',
      ]);
    },
  );
  it.each(['codesign', 'spctl', 'xcrun'])('fails if %s rejects the app', (tool) => {
    const dir = temp();
    appFixture(dir, 'x64');
    expect(
      shell(dir, 'bash scripts/verify-macos-build.sh x64 true', { FAIL_TOOL: tool }).status,
    ).toBe(42);
  });
  it('verifies native payloads for unsigned manual builds without requiring signing tools', () => {
    const dir = temp();
    const app = appFixture(dir, 'x64');
    const code = render(
      step('manual-signed-build', 'build-macos', 'Verify packaged Mac build').run!,
      { 'matrix.arch': 'x64', 'inputs.sign': 'false' },
    );
    expect(shell(dir, code).status).toBe(0);
    expect(existsSync(join(dir, 'verification'))).toBe(false);
    writeFileSync(
      join(app, 'Contents/Resources/intentd/intentd'),
      readFileSync('node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'),
    );
    const wrong = shell(dir, code);
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain('Wrong architecture');
  });
  it.each(['dmg', 'zip'])('requires the %s artifact before uploading installers', (kind) => {
    const dir = temp();
    appFixture(dir, 'x64');
    const name = kind === 'dmg' ? 'Intent-1.2.3-x64.dmg' : 'Intent-1.2.3-x64-mac.zip';
    rmSync(join(dir, 'dist-electron', name));
    expect(shell(dir, 'bash scripts/verify-macos-build.sh x64 true').status).not.toBe(0);
    expect(existsSync(join(dir, 'verification'))).toBe(false);
  });
});

it('keeps unsigned manual packaging functional with signing inputs removed', () => {
  const dir = temp();
  stub(dir, 'pnpm', 'test -z "${CSC_LINK+x}" && test -z "${CSC_KEY_PASSWORD+x}"');
  const code = render(
    step('manual-signed-build', 'build-macos', 'Build and package macOS app').run!,
    { 'matrix.arch': 'x64', 'inputs.sign': 'false' },
  );
  expect(shell(dir, code, { CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret' }).status).toBe(0);
});
