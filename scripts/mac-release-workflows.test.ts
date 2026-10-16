// @verify-changed-triggers: .github/workflows/release-alpha.yml, .github/workflows/manual-signed-build.yml, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml, scripts/assemble-release-assets.mjs, scripts/verify-macos-build.sh, scripts/mac-update-feed.mjs, scripts/run-packaged-macos-smoke.py, scripts/test_packaged_macos_smoke.py
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  cpSync,
  renameSync,
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
  id?: string;
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
  if?: string;
  needs?: string[];
  'runs-on'?: string;
  outputs?: Record<string, string>;
  strategy?: { matrix: { include: Matrix[] } | string };
  env?: Record<string, string>;
}
interface Workflow {
  jobs: Record<string, Job>;
  on: { workflow_dispatch: { inputs: Record<string, unknown> } };
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
  mkdirSync(join(dir, '.release-tools/scripts'), { recursive: true });
  symlinkSync(resolve('node_modules'), join(dir, '.release-tools/node_modules'));
  for (const file of [
    'package-mac.mjs',
    'assemble-release-assets.mjs',
    'mac-update-feed.mjs',
    'validate-release-asset-names.mjs',
    'verify-macos-build.sh',
    'macos-native.cjs',
    'fetch-sidecar-lib.mjs',
    'mac-channel-feeds.mjs',
  ]) {
    copyFileSync(resolve('scripts', file), join(dir, 'scripts', file));
    copyFileSync(resolve('scripts', file), join(dir, '.release-tools/scripts', file));
  }
  symlinkSync(resolve('node_modules'), join(dir, 'node_modules'));
  writeFileSync(join(dir, 'intentd.version'), '0.10.46');
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
function fixtures(dir: string, arches = ['arm64']) {
  const downloads = join(dir, 'release-downloads');
  mkdirSync(downloads);
  for (const arch of arches) {
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
  it('preserves ARM archives and blockmaps, other platforms, and identical Mac feeds', () => {
    const dir = temp();
    fixtures(dir);
    const result = assemble(dir);
    expect(result.status, result.stderr).toBe(0);
    const output = join(dir, 'dist-electron');
    const feed = load(readFileSync(join(output, 'latest-mac.yml'), 'utf8'));
    expect(feed.files.map((f: { url: string }) => f.url)).toEqual([
      'Intent-1.2.3-arm64-mac.zip',
      'Intent-1.2.3-arm64.dmg',
    ]);
    for (const f of feed.files) {
      const bytes = readFileSync(join(output, f.url));
      expect(createHash('sha512').update(bytes).digest('base64')).toBe(f.sha512);
      expect(readFileSync(join(output, `${f.url}.blockmap`), 'utf8')).toBe(`blockmap ${f.url}`);
    }
    expect(feed.path).toBe('Intent-1.2.3-arm64-mac.zip');
    expect(readFileSync(join(output, 'latest-arm64-mac.yml'), 'utf8')).toBe(
      readFileSync(join(output, 'latest-mac.yml'), 'utf8'),
    );
    expect(readFileSync(join(output, 'Intent.Setup.1.2.3.exe'), 'utf8')).toBe(
      'release-windows payload',
    );
    expect(readdirSync(output)).toHaveLength(12);
    expect(existsSync(join(dir, 'release-downloads/release-macos-arm64/latest-mac.yml'))).toBe(
      true,
    );
  });
  it.each([
    'missing ARM',
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
    const arm = join(downloads, 'release-macos-arm64');
    if (failure === 'missing ARM') rmSync(arm, { recursive: true });
    if (failure === 'missing DMG' || failure === 'missing ZIP') {
      const path = join(arm, 'latest-mac.yml');
      const feed = load(readFileSync(path, 'utf8'));
      feed.files = feed.files.filter(
        (f: { url: string }) => !f.url.endsWith(failure === 'missing DMG' ? '.dmg' : '.zip'),
      );
      delete feed.path;
      delete feed.sha512;
      writeFileSync(path, dump(feed));
    }
    if (failure === 'corrupt archive')
      writeFileSync(join(arm, 'Intent-1.2.3-arm64-mac.zip'), 'corrupted');
    if (failure === 'collision')
      writeFileSync(join(downloads, 'release-windows/Intent-1.2.3-arm64.dmg'), 'overwritten');
    if (failure === 'symlink') symlinkSync('/dev/null', join(arm, 'extra.blockmap'));
    if (failure === 'missing Linux feed')
      rmSync(join(downloads, 'release-linux-arm64/latest-linux-arm64.yml'));
    const result = assemble(dir, failure === 'wrong version' ? '9.9.9' : '1.2.3');
    expect(result.status, result.stdout).not.toBe(0);
    expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
  });
  it.each(['complete', 'corrupt', 'partial'])(
    'rejects accidental Intel job output when %s',
    (failure) => {
      const dir = temp();
      const downloads = fixtures(dir, ['arm64', 'x64']);
      const intel = join(downloads, 'release-macos-x64');
      if (failure === 'corrupt') writeFileSync(join(intel, 'Intent-1.2.3-x64-mac.zip'), 'bad');
      if (failure === 'partial') rmSync(join(intel, 'Intent-1.2.3-x64.dmg.blockmap'));
      const result = assemble(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unexpected release artifact: release-macos-x64');
      expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
    },
  );
  it.each(['Intent-1.2.3-x64.dmg', 'Intent-1.2.3-x64-mac.zip.blockmap'])(
    'rejects a misplaced Intel payload %s in another platform job',
    (asset) => {
      const dir = temp();
      const downloads = fixtures(dir);
      writeFileSync(join(downloads, 'release-windows', asset), 'wrong platform');
      const result = assemble(dir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Mac asset outside the Apple Silicon job');
      expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
    },
  );
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
  it('uses the Apple Silicon runner and sidecar and invokes ARM packaging', () => {
    const job = workflow(name).jobs['build-macos'];
    const configured = job.strategy!.matrix;
    const matrix: Matrix[] = (
      typeof configured === 'string'
        ? JSON.parse(
            render(configured, {
              'fromJSON(needs.resolve.outputs.macos_matrix)': releasePlan(temp()).matrix,
              'fromJSON(needs.select-macos.outputs.matrix)': manualPlan(temp()).matrix,
            }),
          )
        : configured
    ).include;
    expect(matrix.map((m) => [m.arch, m.runner, m.intentd_target])).toEqual([
      ['arm64', 'depot-macos-latest', 'aarch64-apple-darwin'],
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
        render(run.run!, {
          'matrix.arch': row.arch,
          'inputs.sign': 'true',
          'inputs.isolated_test': 'false',
          'steps.intentd_sha.outputs.sha': 'a'.repeat(40),
        }),
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
        name === 'release-alpha' ? '1' : "${{ inputs.sign && !inputs.isolated_test && '1' || '' }}",
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
  it('uploads ARM assets and blockmaps before replacing both feed aliases', () => {
    const dir = temp();
    fixtures(dir);
    expect(assemble(dir).status).toBe(0);
    symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
    const prepared = shell(
      dir,
      step(name, `promote-to-${channel}`, 'Prepare architecture-safe Mac channel feeds').run!,
      { VERSION: '1.2.3' },
    );
    expect(prepared.status, prepared.stderr).toBe(0);
    stub(dir, 'gh', 'printf "%s\\n" "$*" >> "$RUNNER_TEMP/uploads"');
    const result = shell(
      dir,
      step(name, `promote-to-${channel}`, `Upload new assets to ${channel}`).run!,
      { VERSION: '1.2.3', GITHUB_OUTPUT: join(dir, 'outputs') },
    );
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(join(dir, 'uploads'), 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    for (const arch of ['arm64']) {
      expect(calls[0]).toContain(`Intent-1.2.3-${arch}-mac.zip`);
      expect(calls[0]).toContain(`Intent-1.2.3-${arch}.dmg.blockmap`);
    }
    expect(calls[0]).not.toContain('latest-mac.yml');
    expect(calls[0]).not.toContain('latest-arm64-mac.yml');
    expect(calls[0]).toContain('Intent.Setup.1.2.3.exe');
    expect(calls[0]).toContain('Intent-1.2.3.AppImage');
    expect(calls[0]).toContain('Intent-1.2.3-arm64.AppImage');
    expect(calls[1]).toContain('latest-mac.yml');
    expect(calls[1]).toContain('latest-arm64-mac.yml');
  });
  it('promotes only the selected historical release, stripping Intel payloads without a channel lookup', () => {
    const dir = temp();
    const downloads = fixtures(dir, ['x64', 'arm64']);
    const assets = join(dir, 'selected-assets');
    mkdirSync(assets);
    const feeds = ['x64', 'arm64'].map((arch) => {
      const job = join(downloads, `release-macos-${arch}`);
      cpSync(job, assets, { recursive: true });
      return load(readFileSync(join(job, 'latest-mac.yml'), 'utf8'));
    });
    writeFileSync(
      join(assets, 'latest-mac.yml'),
      dump({
        ...feeds[0],
        files: feeds.flatMap((feed) => feed.files),
      }),
    );
    stub(
      dir,
      'gh',
      `
      printf '%s\\n' "$*" >> "$RUNNER_TEMP/gh-calls"
      if [ "$1 $2 $3" != 'release download v1.2.3' ]; then exit 42; fi
      cp -R "$RUNNER_TEMP/selected-assets/." .
    `,
    );
    const downloaded = shell(
      dir,
      step(name, `promote-to-${channel}`, 'Download versioned release assets').run!,
      { VERSION: '1.2.3' },
    );
    expect(downloaded.status, downloaded.stderr).toBe(0);
    const result = shell(
      dir,
      step(name, `promote-to-${channel}`, 'Prepare architecture-safe Mac channel feeds').run!,
      { VERSION: '1.2.3' },
    );
    expect(result.status, result.stderr).toBe(0);
    const output = join(dir, 'release-assets');
    const shared = readFileSync(join(output, 'latest-mac.yml'), 'utf8');
    expect(readFileSync(join(output, 'latest-arm64-mac.yml'), 'utf8')).toBe(shared);
    expect(load(shared)).toMatchObject({ version: '1.2.3', path: 'Intent-1.2.3-arm64-mac.zip' });
    expect(readdirSync(output).some((file) => file.includes('x64'))).toBe(false);
    expect(readFileSync(join(dir, 'gh-calls'), 'utf8').trim().split('\n')).toEqual([
      'release download v1.2.3 --repo intent-hq/cloudlands-releases',
    ]);
  });
  it.each([false, true])('compares the whole feed with changed ARM metadata=%s', (corrupt) => {
    const dir = temp();
    const original =
      'version: 1.2.3\nsha512: unchanged-top-level-hash\nfiles:\n  - url: Intent-arm64-mac.zip\n    sha512: arm-hash\n';
    mkdirSync(join(dir, 'release-assets'));
    writeFileSync(join(dir, 'release-assets/latest-mac.yml'), original);
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
  it.each(['arm64'])(
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
    appFixture(dir, 'arm64');
    expect(
      shell(dir, 'bash scripts/verify-macos-build.sh arm64 true', { FAIL_TOOL: tool }).status,
    ).toBe(42);
  });
  it('verifies native payloads for unsigned manual builds without requiring signing tools', () => {
    const dir = temp();
    const app = appFixture(dir, 'arm64');
    const code = render(
      step('manual-signed-build', 'build-macos', 'Verify packaged Mac build').run!,
      { 'matrix.arch': 'arm64', 'inputs.sign': 'false' },
    );
    expect(shell(dir, code).status).toBe(0);
    expect(existsSync(join(dir, 'verification'))).toBe(false);
    writeFileSync(
      join(app, 'Contents/Resources/intentd/intentd'),
      readFileSync('node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'),
    );
    const wrong = shell(dir, code);
    expect(wrong.status).not.toBe(0);
    expect(wrong.stderr).toContain('Wrong architecture');
  });
  it.each(['dmg', 'zip'])('requires the %s artifact before uploading installers', (kind) => {
    const dir = temp();
    appFixture(dir, 'arm64');
    const name = kind === 'dmg' ? 'Intent-1.2.3-arm64.dmg' : 'Intent-1.2.3-arm64-mac.zip';
    rmSync(join(dir, 'dist-electron', name));
    expect(shell(dir, 'bash scripts/verify-macos-build.sh arm64 true').status).not.toBe(0);
    expect(existsSync(join(dir, 'verification'))).toBe(false);
  });
});

it.each(['arm64'])('keeps unsigned %s manual packaging free of signing and publishing', (arch) => {
  const dir = temp();
  stub(
    dir,
    'pnpm',
    'test -z "${CSC_LINK+x}" && test -z "${CSC_KEY_PASSWORD+x}" || exit 1\nprintf "%s\\n" "$@" > "$RUNNER_TEMP/unsigned-args"',
  );
  const code = render(
    step('manual-signed-build', 'build-macos', 'Build and package macOS app').run!,
    {
      'matrix.arch': arch,
      'inputs.sign': 'false',
      'inputs.isolated_test': 'false',
      'steps.intentd_sha.outputs.sha': 'a'.repeat(40),
    },
  );
  expect(shell(dir, code, { CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret' }).status).toBe(0);
  expect(readFileSync(join(dir, 'unsigned-args'), 'utf8').trim().split('\n')).toEqual([
    'run',
    'dist:mac',
    `--${arch}`,
    '--publish',
    'never',
  ]);
});

describe.each(['arm64'])('%s differential update artifacts', (arch) => {
  it.each(['mac.zip', 'dmg'])('requires the %s blockmap', (kind) => {
    const dir = temp();
    const downloads = fixtures(dir);
    const archive = kind === 'dmg' ? `Intent-1.2.3-${arch}.dmg` : `Intent-1.2.3-${arch}-mac.zip`;
    rmSync(join(downloads, `release-macos-${arch}`, `${archive}.blockmap`));
    const result = assemble(dir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${archive}.blockmap`);
    expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
  });
});

it.each(['empty', 'symlink'])('rejects an %s blockmap beside the native archive', (kind) => {
  const dir = temp();
  const downloads = fixtures(dir);
  const map = join(downloads, 'release-macos-arm64/Intent-1.2.3-arm64-mac.zip.blockmap');
  if (kind === 'empty') writeFileSync(map, '');
  else {
    rmSync(map);
    symlinkSync('Intent-1.2.3-arm64-mac.zip', map);
  }
  expect(assemble(dir).status).not.toBe(0);
  expect(existsSync(join(dir, 'dist-electron'))).toBe(false);
});

function manualPlan(dir: string, arch?: string) {
  const job = workflow('manual-signed-build').jobs['select-macos'];
  const select = step('manual-signed-build', 'select-macos', 'Select manual Mac targets');
  const output = join(dir, 'manual-plan');
  const env = Object.fromEntries(
    Object.entries(select.env!).map(([key, value]) => [
      key,
      render(value, { 'inputs.macos_arch': arch ?? '' }),
    ]),
  );
  const result = shell(dir, select.run!, { ...env, GITHUB_OUTPUT: output });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  const context = Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const split = line.indexOf('=');
        return [`steps.${select.id}.outputs.${line.slice(0, split)}`, line.slice(split + 1)];
      }),
  );
  return Object.fromEntries(
    Object.entries(job.outputs!).map(([key, value]) => [key, render(value, context)]),
  );
}

it('runs the packaged smoke admission and executable regressions for both native CPUs', () => {
  const result = spawnSync('python3', ['-B', 'scripts/test_packaged_macos_smoke.py'], {
    encoding: 'utf8',
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

describe('manual Mac architecture selection', () => {
  const cases = [
    { choice: 'arm64', arches: ['arm64'] },
    { choice: '', arches: ['arm64'] },
    { choice: undefined, arches: ['arm64'] },
  ];

  it('offers an optional architecture choice while keeping the platform opt-in', () => {
    const inputs = workflow('manual-signed-build').on.workflow_dispatch.inputs;
    expect(inputs.macos_arch).toMatchObject({
      required: false,
      type: 'choice',
      default: 'arm64',
      options: ['arm64'],
    });
    expect(inputs.build_macos).toMatchObject({ type: 'boolean', default: false });
  });

  it.each(cases)('builds only the selected native targets for "$choice"', ({ choice, arches }) => {
    const jobs = workflow('manual-signed-build').jobs;
    const build = jobs['build-macos'];
    expect(build.needs).toContain('select-macos');
    const plan = manualPlan(temp(), choice);
    const matrix: { include: Matrix[] } = JSON.parse(
      render(String(build.strategy!.matrix), {
        'fromJSON(needs.select-macos.outputs.matrix)': plan.matrix,
      }),
    );
    expect(matrix.include.map((row) => row.arch)).toEqual(arches);
    for (const row of matrix.include) {
      expect(render(build['runs-on']!, { 'matrix.runner': row.runner })).toBe('depot-macos-latest');
      expect(
        render(build.env!.INTENTD_TARGET, { 'matrix.intentd_target': row.intentd_target }),
      ).toBe('aarch64-apple-darwin');
    }
    // Job-level conditions are evaluated before matrix expansion in Actions.
    for (const enabled of [true, false]) {
      for (const isolated of [true, false]) {
        for (const name of ['select-macos', 'build-macos']) {
          expect(
            JSON.parse(
              render(jobs[name].if!, {
                'inputs.build_macos || inputs.isolated_test': String(enabled || isolated),
              }),
            ),
          ).toBe(enabled || isolated);
        }
      }
    }
  });

  it.each(cases)(
    'smokes a selected artifact on its native runner for "$choice"',
    ({ choice, arches }) => {
      const jobs = workflow('manual-signed-build').jobs;
      const plan = manualPlan(temp(), choice);
      const context = Object.fromEntries(
        Object.entries(plan).map(([key, value]) => [`needs.select-macos.outputs.${key}`, value]),
      );
      const smoke = jobs['smoke-macos'];
      expect(smoke.needs).toEqual(['select-macos', 'build-macos', 'smoke-inputs']);
      expect(smoke.if).toBe('${{ inputs.smoke_macos }}');
      const row = (JSON.parse(plan.matrix).include as Matrix[]).find((m) => m.arch === arches[0])!;
      const upload = step('manual-signed-build', 'build-macos', 'Upload macOS DMG artifact');
      const download = smoke.steps.find((s) => s.uses?.startsWith('actions/download-artifact@'))!;
      expect(render(smoke['runs-on']!, context)).toBe(row.runner);
      expect(render(String(download.with?.name), context)).toBe(
        render(String(upload.with?.name), { 'matrix.arch': row.arch }),
      );
    },
  );

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('requires a built and signed smoke artifact: build=%s sign=%s', (build, sign, valid) => {
    const gate = workflow('manual-signed-build').jobs['smoke-inputs'];
    expect(gate.if).toBe('${{ inputs.smoke_macos }}');
    const check = step('manual-signed-build', 'smoke-inputs', 'Require a signed macOS artifact');
    const env = Object.fromEntries(
      Object.entries(check.env!).map(([key, value]) => [
        key,
        render(value, { 'inputs.build_macos': String(build), 'inputs.sign': String(sign) }),
      ]),
    );
    expect(shell(temp(), check.run!, env).status === 0).toBe(valid);
  });

  it.each(['universal', 'both', 'x64'])(
    'rejects %s instead of scheduling Intel manual builds',
    (arch) => {
      expect(() => manualPlan(temp(), arch)).toThrow('Mac builds support arm64 only');
    },
  );
});

describe.each(['arm64'])('manual %s summary reports verified and uploaded results', (arch) => {
  it.each([
    ['failure', 'skipped', false],
    ['success', 'failure', false],
    ['success', 'success', true],
  ])(
    'verification=%s and upload=%s yields download availability=%s',
    (verification, upload, available) => {
      const dir = temp();
      mkdirSync(join(dir, 'dist-electron'));
      writeFileSync(join(dir, `dist-electron/Intent-1.2.3-${arch}.dmg`), 'installer');
      writeFileSync(join(dir, 'intentd.version'), '0.9.124');
      const code = render(step('manual-signed-build', 'build-macos', 'Post summary').run!, {
        'matrix.label': 'Apple Silicon',
        'matrix.arch': arch,
        'inputs.sign': 'true',
        'steps.build.outcome': 'success',
        'steps.verify.outcome': String(verification),
        'steps.upload.outcome': String(upload),
        'steps.upload.outputs.artifact-url': 'https://example.test/artifact',
      });
      expect(
        shell(dir, code, { INTENTD_REF: '', GITHUB_STEP_SUMMARY: join(dir, 'summary') }).status,
      ).toBe(0);
      const summary = readFileSync(join(dir, 'summary'), 'utf8');
      if (available) {
        expect(summary).toContain('Signed build completed');
        expect(summary).toContain('https://example.test/artifact');
        expect(summary).toContain(`Intent-1.2.3-${arch}.dmg`);
        expect(summary).toContain(`manual-macos-dmg-${arch}`);
      } else {
        expect(summary).not.toContain('Signed build completed');
        expect(summary).not.toContain(`Intent-1.2.3-${arch}.dmg`);
        expect(summary).not.toContain('https://example.test/artifact');
      }
    },
  );
});

// Historical v2.191.0 has neither the native wrapper nor the verifier/assembler.
// Read the current workflow's actual conditions against that checkout capability.
function releaseStepEnabled(s: Step, modern: boolean) {
  if (!s.if) return true;
  const expression = s.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim();
  const match = /^needs\.resolve\.outputs\.native_macos (==|!=) 'true'$/.exec(expression);
  if (!match) throw new Error(`Unexpected release condition: ${s.if}`);
  return match[1] === '==' ? modern : !modern;
}

it('does not call absent Mac verification tooling when rebuilding an ARM-only tag', () => {
  const dir = temp();
  legacyCheckout(dir);
  const modern = releasePlan(dir).native_macos === 'true';
  const verify = step('release-alpha', 'build-macos', 'Verify packaged Mac build');
  const result = shell(
    dir,
    releaseStepEnabled(verify, modern) ? render(verify.run!, { 'matrix.arch': 'arm64' }) : ':',
  );
  expect(result.status, result.stderr).toBe(0);
});

it('rebuilds a historical ARM-only tag while using current publication dependencies', () => {
  const dir = temp();
  legacyCheckout(dir);
  const modern = releasePlan(dir).native_macos === 'true';
  const assembleStep = step('release-alpha', 'publish', 'Assemble release assets');
  const result = shell(dir, releaseStepEnabled(assembleStep, modern) ? assembleStep.run! : ':', {
    VERSION: '2.191.0',
  });
  expect(result.status, result.stderr).toBe(0);
  expect(
    releaseStepEnabled(
      step('release-alpha', 'publish', 'Install feed assembly dependencies'),
      false,
    ),
  ).toBe(true);
});

const nativeReleaseTools = [
  'package-mac.mjs',
  'verify-macos-build.sh',
  'assemble-release-assets.mjs',
];
function legacyCheckout(dir: string) {
  for (const file of nativeReleaseTools) rmSync(join(dir, 'scripts', file));
}
function releasePlan(dir: string) {
  const output = join(dir, 'release-plan');
  const result = shell(dir, step('release-alpha', 'resolve', 'Select Mac release targets').run!, {
    GITHUB_OUTPUT: output,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  return Object.fromEntries(
    readFileSync(output, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const split = line.indexOf('=');
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
}

describe('release tag capability routing', () => {
  it('never looks up or schedules Intel sidecars', () => {
    const dir = temp();
    stub(dir, 'gh', 'echo unexpected lookup > "$RUNNER_TEMP/gh-calls"; exit 1');
    expect(JSON.parse(releasePlan(dir).matrix).include.map((row: Matrix) => row.arch)).toEqual([
      'arm64',
    ]);
    expect(existsSync(join(dir, 'gh-calls'))).toBe(false);
  });

  it.each([false, true])(
    'assembles current ARM feeds for native tooling available=%s',
    (modern) => {
      const dir = temp();
      if (!modern) legacyCheckout(dir);
      const plan = releasePlan(dir);
      expect(plan.native_macos).toBe(String(modern));
      const configured = workflow('release-alpha').jobs['build-macos'].strategy!.matrix;
      const matrix =
        typeof configured === 'string'
          ? JSON.parse(
              render(configured, { 'fromJSON(needs.resolve.outputs.macos_matrix)': plan.matrix }),
            )
          : configured;
      expect(matrix.include.map((m: Matrix) => m.arch)).toEqual(['arm64']);

      const source = fixtures(dir);
      const artifacts = join(dir, 'actions-artifacts');
      renameSync(source, artifacts);
      const downloads = workflow('release-alpha').jobs.publish.steps.filter(
        (s) => s.uses?.startsWith('actions/download-artifact@') && releaseStepEnabled(s, modern),
      );
      expect(downloads).toHaveLength(1);
      const download = downloads[0].with!;
      const destination = join(dir, String(download.path));
      mkdirSync(destination);
      for (const name of readdirSync(artifacts)) {
        const target = download['merge-multiple'] === true ? destination : join(destination, name);
        cpSync(join(artifacts, name), target, { recursive: true });
      }
      const assembleStep = step('release-alpha', 'publish', 'Assemble release assets');
      if (releaseStepEnabled(assembleStep, modern)) {
        const result = shell(dir, assembleStep.run!, { VERSION: '1.2.3' });
        expect(result.status, result.stderr).toBe(0);
      }
      stub(dir, 'gh', 'echo "gh: Not Found (HTTP 404)" >&2; exit 1');
      const prepared = shell(
        dir,
        step('release-alpha', 'publish', 'Prepare architecture-safe Mac channel feeds').run!,
        { VERSION: '1.2.3' },
      );
      expect(prepared.status, prepared.stderr).toBe(0);
      const verified = shell(
        dir,
        step('release-alpha', 'publish', 'Verify collected release assets').run!,
      );
      expect(verified.status, verified.stderr).toBe(0);
      const feed = load(readFileSync(join(dir, 'dist-electron/latest-mac.yml'), 'utf8'));
      expect(
        feed.files
          .filter((f: { url: string }) => f.url.endsWith('.zip'))
          .map((f: { url: string }) => f.url),
      ).toEqual(['Intent-1.2.3-arm64-mac.zip']);
      expect(
        releaseStepEnabled(
          step('release-alpha', 'build-macos', 'Verify packaged Mac build'),
          modern,
        ),
      ).toBe(modern);
      expect(
        releaseStepEnabled(
          step('release-alpha', 'publish', 'Install feed assembly dependencies'),
          modern,
        ),
      ).toBe(true);
      const summary = shell(dir, step('release-alpha', 'publish', 'Post summary').run!, {
        VERSION: '1.2.3',
        GITHUB_STEP_SUMMARY: join(dir, 'summary'),
      });
      expect(summary.status, summary.stderr).toBe(0);
      const markdown = readFileSync(join(dir, 'summary'), 'utf8');
      expect(markdown).toContain('/Intent-1.2.3-arm64.dmg');
      expect(markdown).not.toContain('/Intent-1.2.3-x64.dmg');
    },
  );
  it.each(nativeReleaseTools)('fails closed when modern tag is missing %s', (missing) => {
    const dir = temp();
    rmSync(join(dir, 'scripts', missing));
    expect(() => releasePlan(dir)).toThrow('Incomplete native Mac release tooling');
  });
});

it.each(['alpha', 'beta', 'stable'])(
  'rejects a mismatched selected release before publishing %s',
  (channel) => {
    const dir = temp();
    fixtures(dir);
    expect(assemble(dir).status).toBe(0);
    symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
    stub(dir, 'gh', 'echo published > "$RUNNER_TEMP/published"');
    const name =
      channel === 'alpha'
        ? 'release-alpha'
        : channel === 'beta'
          ? 'promote-beta'
          : 'release-stable';
    const job = channel === 'alpha' ? 'publish' : `promote-to-${channel}`;
    const prepare = step(name, job, 'Prepare architecture-safe Mac channel feeds');
    const publish = step(
      name,
      job,
      channel === 'alpha'
        ? 'Publish to GitHub Releases (versioned tag)'
        : `Upload new assets to ${channel}`,
    );
    const result = shell(dir, `${prepare.run}\n${publish.run}`, {
      VERSION: '9.9.9',
      GITHUB_OUTPUT: join(dir, 'outputs'),
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Mac feed must match the selected release');
    expect(existsSync(join(dir, 'published'))).toBe(false);
  },
);

it.each(['alpha', 'beta', 'stable'])(
  'does not switch %s feeds after a failed payload upload',
  (channel) => {
    const dir = temp();
    fixtures(dir);
    expect(assemble(dir).status).toBe(0);
    symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
    stub(
      dir,
      'gh',
      `
    printf '%s\\n' "$*" >> "$RUNNER_TEMP/publish-calls"
    if [ "$1 $2" = 'release upload' ]; then exit 42; fi
  `,
    );
    const publish =
      channel === 'alpha'
        ? step('release-alpha', 'publish', 'Publish to GitHub Releases (rolling alpha tag)')
        : step(
            channel === 'beta' ? 'promote-beta' : 'release-stable',
            `promote-to-${channel}`,
            `Upload new assets to ${channel}`,
          );
    expect(
      shell(dir, publish.run!, { VERSION: '1.2.3', GITHUB_OUTPUT: join(dir, 'outputs') }).status,
    ).toBe(42);
    const calls = readFileSync(join(dir, 'publish-calls'), 'utf8');
    expect(calls).toContain('Intent-1.2.3-arm64-mac.zip');
    expect(calls).not.toContain('latest-mac.yml');
    expect(calls).not.toContain('latest-arm64-mac.yml');
    expect(calls).not.toContain('delete-asset');
  },
);

it.each(['beta', 'stable'])(
  'reads %s advancement from the ARM feed, with legacy fallback only on 404',
  (channel) => {
    for (const status of ['200', '404', '503']) {
      const dir = temp();
      stub(
        dir,
        'curl',
        `
      out=''; while [ "$#" -gt 0 ]; do
        if [ "$1" = '-o' ]; then out="$2"; shift 2; else url="$1"; shift; fi
      done
      printf '%s\\n' "$url" >> "$RUNNER_TEMP/urls"
      case "$url" in
        *latest-arm64-mac.yml) echo 'version: 3.0.0' > "$out"; printf '%s' '${status}' ;;
        *) echo 'version: 2.0.0' > "$out"; printf '200' ;;
      esac
    `,
      );
      const run = step(
        channel === 'beta' ? 'promote-beta' : 'release-stable',
        `promote-to-${channel}`,
        `Read current ${channel} version`,
      ).run!;
      const result = shell(dir, run, { GITHUB_OUTPUT: join(dir, 'outputs') });
      if (status === '503') expect(result.status).not.toBe(0);
      else {
        expect(result.status, result.stderr).toBe(0);
        expect(readFileSync(join(dir, 'outputs'), 'utf8')).toContain(
          `prev_${channel}=${status === '200' ? '3.0.0' : '2.0.0'}`,
        );
      }
      expect(readFileSync(join(dir, 'urls'), 'utf8').trim().split('\n')).toHaveLength(
        status === '404' ? 2 : 1,
      );
    }
  },
);

it('requires every platform build to succeed before publication', () => {
  const jobs = workflow('release-alpha').jobs;
  expect(jobs.publish.needs).toEqual(['resolve', 'build-macos', 'build-windows', 'build-linux']);
  for (const platform of ['macos', 'windows', 'linux']) {
    expect(
      (jobs[`build-${platform}`] as Record<string, unknown>)['continue-on-error'],
    ).toBeUndefined();
  }
  expect(jobs['build-macos'].strategy).toMatchObject({ 'fail-fast': false });
});

it.each([
  ['push', 'v1.2.3', '', 'present', true],
  ['push', 'main', '', 'present', false],
  ['workflow_dispatch', 'main', 'v1.2.3', 'present', true],
  ['workflow_dispatch', 'main', 'v1.2.3', 'absent', false],
  ['workflow_dispatch', 'main', 'main', 'present', false],
])(
  'admits only actual release tags: %s pushed=%s input=%s exists=%s',
  (event, pushed, input, exists, valid) => {
    const dir = temp();
    stub(dir, 'gh', exists === 'present' ? 'exit 0' : 'exit 1');
    const output = join(dir, 'tag-output');
    const result = shell(dir, step('release-alpha', 'resolve', 'Resolve release tag').run!, {
      EVENT_NAME: String(event),
      PUSHED_TAG: String(pushed),
      INPUT_TAG: String(input),
      REPO: 'intent-hq/cloudlands-fe',
      GITHUB_OUTPUT: output,
    });
    expect(result.status === 0).toBe(valid);
    if (valid) expect(readFileSync(output, 'utf8')).toContain('tag=v1.2.3');
    else expect(existsSync(output)).toBe(false);
  },
);
