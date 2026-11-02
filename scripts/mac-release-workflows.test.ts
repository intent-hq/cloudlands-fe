// @verify-changed-triggers: .github/workflows/release-alpha.yml, scripts/test-fixtures/release-oldest-tag.json, .github/workflows/manual-signed-build.yml, scripts/run-until-notarizing.mjs, .github/workflows/promote-beta.yml, .github/workflows/release-stable.yml, scripts/assemble-release-assets.mjs, scripts/verify-macos-build.sh, scripts/apple-ticket-retry.mjs, scripts/mac-update-feed.mjs, scripts/run-packaged-macos-smoke.py, scripts/test_packaged_macos_smoke.py, src/features/auto-update/main/mac-update-compatibility.ts
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
import { runInNewContext } from 'node:vm';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
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
  warp: string;
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
    'apple-ticket-retry.mjs',
    'macos-native.cjs',
    'fetch-sidecar-lib.mjs',
    'mac-channel-feeds.mjs',
    'run-until-notarizing.mjs',
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
  it('preserves ARM archives and blockmaps, other platforms, and only the standard Mac feed', () => {
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
    expect(existsSync(join(output, 'latest-arm64-mac.yml'))).toBe(false);
    expect(readFileSync(join(output, 'Intent.Setup.1.2.3.exe'), 'utf8')).toBe(
      'release-windows payload',
    );
    expect(readdirSync(output)).toHaveLength(11);
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
      ['arm64', 'macos-15-xlarge', 'aarch64-apple-darwin'],
    ]);
    for (const row of matrix) {
      const dir = temp();
      stub(
        dir,
        'pnpm',
        'printf "%s\\n" "$@" > "$RUNNER_TEMP/args"\nprintf "%s" "${CSC_LINK-unset}" > "$RUNNER_TEMP/cert"\nprintf "%s" "${INTENT_NOTARIZE_STARTED_FILE-unset}" > "$RUNNER_TEMP/marker"',
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
      // Packaging runs under the pre-notarization stall deadline, which hands
      // notarize.js a fresh marker path.
      expect(readFileSync(join(dir, 'marker'), 'utf8')).toMatch(
        /intent-notarize-started-.*started$/,
      );
      expect(run.env?.REQUIRE_SHARED_KEYCHAIN_GROUP).toBe(
        name === 'release-alpha' ? '1' : "${{ inputs.sign && !inputs.isolated_test && '1' || '' }}",
      );
    }
  });
  it('runs packaging under the 30-minute pre-notarization deadline and fails the step when packaging fails', () => {
    const run = step(name, 'build-macos', 'Build and package macOS app').run!;
    // The budget is the stall contract: 2.3x the slowest pre-notarization phase seen.
    // `exec`: on cancel the runner signals the step's process, so the wrapper must be
    // that process to stop the whole build.
    const invocations = run.match(/^.*node scripts\/run-until-notarizing\.mjs.*$/gm) ?? [];
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations)
      expect(line.trim()).toMatch(
        /^exec node scripts\/run-until-notarizing\.mjs --minutes 30 -- pnpm run dist:mac /,
      );
    const dir = temp();
    stub(dir, 'pnpm', 'exit 5');
    const result = shell(
      dir,
      render(run, {
        'matrix.arch': 'arm64',
        'inputs.sign': 'true',
        'inputs.isolated_test': 'false',
        'steps.intentd_sha.outputs.sha': 'a'.repeat(40),
      }),
    );
    expect(result.status).toBe(5);
  });
  // Only release-alpha checks out a different ref (the release tag) from its workflow.
  it.runIf(name === 'release-alpha')(
    'packages a checkout that predates the stall deadline without it',
    () => {
      // release-alpha rebuilds historical tags from the tag's own scripts. A tag cut
      // before the wrapper existed has no wrapper, and its notarize.js never writes
      // the marker, so the workflow-ref wrapper must not be substituted either.
      const dir = temp();
      legacyCheckout(dir);
      expect(existsSync(join(dir, 'scripts', 'run-until-notarizing.mjs'))).toBe(false);
      stub(
        dir,
        'pnpm',
        'printf "%s\\n" "$@" > "$RUNNER_TEMP/args"\nprintf "%s" "${INTENT_NOTARIZE_STARTED_FILE-unset}" > "$RUNNER_TEMP/marker"\nexit 6',
      );
      const result = shell(
        dir,
        render(step(name, 'build-macos', 'Build and package macOS app').run!, {
          'matrix.arch': 'arm64',
          'inputs.sign': 'true',
          'inputs.isolated_test': 'false',
          'steps.intentd_sha.outputs.sha': 'a'.repeat(40),
        }),
      );
      expect(result.status).toBe(6);
      expect(readFileSync(join(dir, 'args'), 'utf8').trim().split('\n')).toEqual([
        'run',
        'dist:mac',
        '--arm64',
        '--publish',
        'never',
      ]);
      expect(readFileSync(join(dir, 'marker'), 'utf8')).toBe('unset');
    },
  );
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
  it('uploads ARM assets and blockmaps before replacing the standard Mac feed', () => {
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
    expect(calls[1]).not.toContain('latest-arm64-mac.yml');
  });
  it.each(['combined', 'split'])(
    'promotes canonical historical releases and rejects retired split releases: %s',
    (format) => {
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
      if (format === 'split') {
        writeFileSync(join(assets, 'latest-arm64-mac.yml'), dump(feeds[1]));
        writeFileSync(join(assets, 'latest-mac.yml'), dump({ ...feeds[0], version: '1.0.0' }));
      }
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
      const output = join(dir, 'release-assets');
      if (format === 'split') {
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('Retired alpha Mac feed');
        expect(readdirSync(output).sort()).toEqual(readdirSync(assets).sort());
        for (const file of readdirSync(assets)) {
          expect(readFileSync(join(output, file))).toEqual(readFileSync(join(assets, file)));
        }
        expect(readFileSync(join(dir, 'gh-calls'), 'utf8').trim().split('\n')).toEqual([
          'release download v1.2.3 --repo intent-hq/cloudlands-releases',
        ]);
        return;
      }
      expect(result.status, result.stderr).toBe(0);
      const shared = readFileSync(join(output, 'latest-mac.yml'), 'utf8');
      expect(existsSync(join(output, 'latest-arm64-mac.yml'))).toBe(false);
      expect(load(shared)).toMatchObject({ version: '1.2.3', path: 'Intent-1.2.3-arm64-mac.zip' });
      expect(readdirSync(output).some((file) => file.includes('x64'))).toBe(false);
      expect(readFileSync(join(dir, 'gh-calls'), 'utf8').trim().split('\n')).toEqual([
        'release download v1.2.3 --repo intent-hq/cloudlands-releases',
      ]);
    },
  );
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
      'Contents/Resources/dock-helper/intent-dock-recorder',
      'Contents/Resources/speech-helper/intent-dock-speech',
      'Contents/Resources/dock-helper/intent-dock-element-pick',
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
  it.each(['', 'codesign', 'spctl', 'xcrun'])(
    'checks the isolated app and retains signing failures (%s)',
    (tool) => {
      const dir = temp();
      const ordinary = appFixture(dir, 'arm64');
      const app = join(dirname(ordinary), 'Intent GitLab Test.app');
      renameSync(ordinary, app);
      rmSync(join(app, 'Contents/Resources/keychain-helper'), { recursive: true });
      writeFileSync(
        join(app, 'Contents/Info.plist'),
        JSON.stringify({
          CFBundleIdentifier: 'app.cloudlands.intent.gitlab-test',
          IntentIsolatedTestBuild: 'manual-123-1',
          IntentIsolatedTestBackend: 'a'.repeat(40),
        }),
      );
      stub(dir, 'plutil', 'cat "${@: -1}"');
      const result = shell(dir, 'bash scripts/verify-macos-build.sh arm64 true', {
        FAIL_TOOL: tool,
      });
      expect(result.status, result.stderr).toBe(tool ? 42 : 0);
      if (!tool)
        expect(readFileSync(join(dir, 'verification'), 'utf8').trim().split('\n')).toEqual([
          'codesign',
          'codesign',
          'spctl',
          'xcrun',
        ]);
    },
  );
  it('retries Apple ticket validation after a lost connection (exit 68)', () => {
    const dir = temp();
    appFixture(dir, 'arm64');
    stub(
      dir,
      'xcrun',
      `printf '%s\\n' "xcrun $*" >> "$RUNNER_TEMP/verification"
if [ "$(grep -c '^xcrun' "$RUNNER_TEMP/verification")" -eq 1 ]; then echo 'NSURLErrorDomain Code=-1005'; exit 68; fi`,
    );
    const result = shell(dir, 'bash scripts/verify-macos-build.sh arm64 true', {
      APPLE_TICKET_RETRY_DELAYS_MS: '0,0,0,0',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(dir, 'verification'), 'utf8').trim().split('\n')).toEqual([
      'codesign',
      'codesign',
      'spctl',
      'xcrun stapler validate dist-electron/mac-arm64/Intent.app',
      'xcrun stapler validate dist-electron/mac-arm64/Intent.app',
    ]);
    expect(result.stdout).toContain('::warning::Apple ticket validate attempt 1/5');
  });
  it('fails Apple ticket validation once every retry loses the connection', () => {
    const dir = temp();
    appFixture(dir, 'arm64');
    stub(dir, 'xcrun', `printf '%s\\n' xcrun >> "$RUNNER_TEMP/verification"\nexit 68`);
    const result = shell(dir, 'bash scripts/verify-macos-build.sh arm64 true', {
      APPLE_TICKET_RETRY_DELAYS_MS: '0,0',
    });
    expect(result.status).toBe(68);
    const calls = readFileSync(join(dir, 'verification'), 'utf8').trim().split('\n');
    expect(calls.filter((call) => call === 'xcrun')).toHaveLength(3);
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
      // The matrix keeps the size label; runs-on maps it to the burst runner (never
      // self-hosted), and falls back to the row's WarpBuild label if routing failed.
      expect(row.runner).toBe('macos-15-xlarge');
      expect(row.warp).toBe('warp-macos-15-arm64-6x');
      expect(build['runs-on']).toBe(
        "${{ fromJSON(needs.runner-route.outputs.cloud || '{}')[matrix.runner] || matrix.warp }}",
      );
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
                '!inputs.isolated_replay && (inputs.build_macos || inputs.isolated_test)': String(
                  enabled || isolated,
                ),
                "!inputs.isolated_replay && (!cancelled() && needs.select-macos.result == 'success' && (inputs.build_macos || inputs.isolated_test))":
                  String(enabled || isolated),
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
      expect(smoke.needs).toEqual(['select-macos', 'build-macos', 'smoke-inputs', 'runner-route']);
      expect(smoke.if).toBe(
        "${{ !inputs.isolated_replay && (!cancelled() && inputs.smoke_macos && needs.select-macos.result == 'success' && needs.build-macos.result == 'success' && needs.smoke-inputs.result == 'success') }}",
      );
      const row = (JSON.parse(plan.matrix).include as Matrix[]).find((m) => m.arch === arches[0])!;
      const upload = step('manual-signed-build', 'build-macos', 'Upload macOS DMG artifact');
      const download = smoke.steps.find((s) => s.uses?.startsWith('actions/download-artifact@'))!;
      // The smoke runs on the row's burst runner (a fresh WarpBuild VM), never a slot.
      expect(smoke['runs-on']).toBe(
        "${{ fromJSON(needs.runner-route.outputs.cloud || '{}')[needs.select-macos.outputs.smoke_runner] || fromJSON(format('[\"{0}\"]', needs.select-macos.outputs.smoke_warp)) }}",
      );
      expect(plan.smoke_runner).toBe(row.runner);
      expect(plan.smoke_warp).toBe(row.warp);
      expect(row.warp).toBe('warp-macos-15-arm64-6x');
      expect(jobs['verify-isolated-macos']['runs-on']).toBe(
        "${{ fromJSON(needs.runner-route.outputs.cloud || '{}')[matrix.runner] || matrix.warp }}",
      );
      expect(jobs['replay-isolated-macos'].needs).toEqual(['runner-route']);
      expect(jobs['replay-isolated-macos']['runs-on']).toBe(
        "${{ fromJSON(needs.runner-route.outputs.cloud || '{}')['macos-15-xlarge'] || fromJSON('[\"warp-macos-15-arm64-6x\"]') }}",
      );
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
    expect(gate.if).toBe('${{ !inputs.isolated_replay && (inputs.smoke_macos) }}');
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

// What the oldest tag release-alpha still rebuilds actually contains, so legacy
// fixtures and the call check below follow the tag rather than today's scripts.
interface TagSnapshot {
  tag: string;
  commit: string;
  files: string[];
  packageScripts: string[];
}
const oldestTag: TagSnapshot = JSON.parse(
  readFileSync('scripts/test-fixtures/release-oldest-tag.json', 'utf8'),
);
const nativeReleaseTools = [
  'scripts/package-mac.mjs',
  'scripts/verify-macos-build.sh',
  'scripts/assemble-release-assets.mjs',
];
// Turn a temp() checkout into the oldest tag's: drop every copied script that tag lacks.
function legacyCheckout(dir: string) {
  for (const file of readdirSync(join(dir, 'scripts'))) {
    if (!oldestTag.files.includes(`scripts/${file}`)) rmSync(join(dir, 'scripts', file));
  }
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
  it.each([false, true])(
    'rejects source using the retired alpha feed before scheduling native tooling=%s',
    (modern) => {
      const dir = temp();
      if (!modern) legacyCheckout(dir);
      const source = join(dir, 'src/features/auto-update/main/mac-update-compatibility.ts');
      mkdirSync(dirname(source), { recursive: true });
      // Frozen retired-alpha routing, independent of the current client implementation.
      writeFileSync(
        source,
        "export const macUpdateChannel = () => ({ channel: 'latest-arm64' });\n",
      );
      expect(() => releasePlan(dir)).toThrow('retired alpha Mac feed');
      expect(existsSync(join(dir, 'release-plan'))).toBe(false);
    },
  );

  it('admits current source after the retired feed routing is removed', () => {
    const dir = temp();
    const source = join(dir, 'src/features/auto-update/main/mac-update-compatibility.ts');
    mkdirSync(dirname(source), { recursive: true });
    copyFileSync(resolve('src/features/auto-update/main/mac-update-compatibility.ts'), source);
    expect(JSON.parse(releasePlan(dir).matrix).include.map((row: Matrix) => row.arch)).toEqual([
      'arm64',
    ]);
  });

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
    rmSync(join(dir, missing));
    expect(() => releasePlan(dir)).toThrow('Incomplete native Mac release tooling');
  });
});

it.each(
  ['alpha', 'beta', 'stable'].flatMap((channel) =>
    ['mismatched', 'retired alpha'].map((failure) => ({ channel, failure })),
  ),
)('rejects a $failure release before publishing $channel', ({ channel, failure }) => {
  const dir = temp();
  fixtures(dir);
  expect(assemble(dir).status).toBe(0);
  symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
  if (failure === 'retired alpha') {
    copyFileSync(
      join(dir, 'dist-electron/latest-mac.yml'),
      join(dir, 'dist-electron/latest-arm64-mac.yml'),
    );
  }
  stub(dir, 'gh', 'echo published > "$RUNNER_TEMP/published"');
  const name =
    channel === 'alpha' ? 'release-alpha' : channel === 'beta' ? 'promote-beta' : 'release-stable';
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
    VERSION: failure === 'mismatched' ? '9.9.9' : '1.2.3',
    GITHUB_OUTPUT: join(dir, 'outputs'),
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    failure === 'mismatched'
      ? 'Mac feed must match the selected release'
      : 'Retired alpha Mac feed',
  );
  expect(existsSync(join(dir, 'published'))).toBe(false);
});

it('creates a versioned release with only the standard Mac feed', () => {
  const dir = temp();
  fixtures(dir);
  expect(assemble(dir).status).toBe(0);
  writeFileSync(join(dir, 'dist-electron/Intent-1.2.3.deb'), 'Debian package');
  writeFileSync(join(dir, 'release-manifest.json'), '{}');
  stub(
    dir,
    'gh',
    `
    printf '%s\\n' "$@" > "$RUNNER_TEMP/versioned-args"
    for arg in "$@"; do
      case "$arg" in dist-electron/*) test -f "$arg" || exit 42 ;; esac
    done
  `,
  );
  const result = shell(
    dir,
    step('release-alpha', 'publish', 'Publish to GitHub Releases (versioned tag)').run!,
    {
      VERSION: '1.2.3',
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const args = readFileSync(join(dir, 'versioned-args'), 'utf8').trim().split('\n');
  expect(args.slice(0, 3)).toEqual(['release', 'create', 'v1.2.3']);
  expect(args.filter((arg) => arg.endsWith('.yml'))).toEqual([
    'dist-electron/latest-mac.yml',
    'dist-electron/latest.yml',
    'dist-electron/latest-linux.yml',
    'dist-electron/latest-linux-arm64.yml',
  ]);
});

it('refuses to change an existing versioned release', () => {
  const dir = temp();
  stub(dir, 'gh', `printf '%s\\n' "$*" >> "$RUNNER_TEMP/gh-calls"`);
  const result = shell(
    dir,
    [
      step('release-alpha', 'resolve', 'Check for duplicate release').run,
      step('release-alpha', 'publish', 'Publish to GitHub Releases (versioned tag)').run,
    ].join('\n'),
    { VERSION: '1.2.3' },
  );
  expect(result.status).not.toBe(0);
  expect(readFileSync(join(dir, 'gh-calls'), 'utf8').trim().split('\n')).toEqual([
    'api repos/intent-hq/cloudlands-releases/releases/tags/v1.2.3',
  ]);
});

describe.each(['alpha', 'beta', 'stable'])('%s rolling publication', (channel) => {
  it.each(['success', 'payload failure', 'feed failure'])(
    'removes obsolete assets only after canonical feed publication: %s',
    (outcome) => {
      const dir = temp();
      fixtures(dir);
      expect(assemble(dir).status).toBe(0);
      symlinkSync(join(dir, 'dist-electron'), join(dir, 'release-assets'));
      stub(
        dir,
        'gh',
        `
        printf '%s\\n' "$*" >> "$RUNNER_TEMP/publish-calls"
        if [ "$1 $2" = 'release upload' ]; then
          case " $* " in
            *' latest-mac.yml '*) [ "$FAIL_UPLOAD" != feed ] || exit 42 ;;
            *) [ "$FAIL_UPLOAD" != payload ] || exit 42 ;;
          esac
        fi
        if [ "$1 $2" = 'release view' ] && [[ " $* " == *' --json assets '* ]]; then
          printf '%s\\n' latest-arm64-mac.yml latest-mac.yml Intent-1.0.0-arm64-mac.zip Intent-1.2.3-arm64-mac.zip latest.yml
        fi
      `,
      );
      const name =
        channel === 'alpha'
          ? 'release-alpha'
          : channel === 'beta'
            ? 'promote-beta'
            : 'release-stable';
      const job = channel === 'alpha' ? 'publish' : `promote-to-${channel}`;
      const labels = new Set(
        channel === 'alpha'
          ? ['Publish to GitHub Releases (rolling alpha tag)']
          : [`Upload new assets to ${channel}`, 'Delete previous version assets'],
      );
      // Execute the production steps in workflow order, each in its own shell scope.
      const run = workflow(name)
        .jobs[job].steps.filter((s) => labels.has(s.name))
        .map((s) => `(\n${s.run}\n)`)
        .join('\n');
      const result = shell(dir, run, {
        VERSION: '1.2.3',
        GITHUB_OUTPUT: join(dir, 'outputs'),
        FAIL_UPLOAD: outcome.split(' ')[0],
      });
      expect(result.status, result.stderr).toBe(outcome === 'success' ? 0 : 42);
      const calls = readFileSync(join(dir, 'publish-calls'), 'utf8').trim().split('\n');
      const uploads = calls.filter((call) => call.startsWith('release upload '));
      expect(uploads).toHaveLength(outcome === 'payload failure' ? 1 : 2);
      expect(uploads[0]).toContain('Intent-1.2.3-arm64-mac.zip');
      expect(uploads[0]).not.toContain('latest-mac.yml');
      expect(uploads.join('\n')).not.toContain('latest-arm64-mac.yml');
      const deletions = calls.filter((call) => call.startsWith('release delete-asset '));
      if (outcome === 'success') {
        expect(uploads[1]).toContain('latest-mac.yml');
        expect(deletions).toEqual([
          `release delete-asset ${channel} latest-arm64-mac.yml --repo intent-hq/cloudlands-releases --yes`,
          `release delete-asset ${channel} Intent-1.0.0-arm64-mac.zip --repo intent-hq/cloudlands-releases --yes`,
        ]);
        expect(calls.indexOf(deletions[0])).toBeGreaterThan(calls.indexOf(uploads[1]));
        expect(calls.every((call) => call.split(' ')[2] === channel)).toBe(true);
      } else {
        expect(deletions).toEqual([]);
      }
    },
  );
});

describe.each(['beta', 'stable'])('%s promotion version discovery', (channel) => {
  it.each(['200', '404', '503'])(
    'reads only the standard Mac feed when HTTP status is %s',
    (status) => {
      const dir = temp();
      stub(
        dir,
        'curl',
        `
      out=''; while [ "$#" -gt 0 ]; do
        if [ "$1" = '-o' ]; then out="$2"; shift 2; else url="$1"; shift; fi
      done
      printf '%s\\n' "$url" >> "$RUNNER_TEMP/urls"
      echo 'version: 3.0.0' > "$out"
      printf '%s' '${status}'
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
        expect(readFileSync(join(dir, 'outputs'), 'utf8').trim().split('\n')).toEqual([
          `prev_${channel}=${status === '200' ? '3.0.0' : ''}`,
          `is_first_promotion=${status === '404'}`,
        ]);
      }
      expect(readFileSync(join(dir, 'urls'), 'utf8').trim().split('\n')).toEqual([
        `https://github.com/intent-hq/cloudlands-releases/releases/download/${channel}/latest-mac.yml`,
      ]);
    },
  );
});

it.each([
  ['200', '1.2.2', false],
  ['200', '1.2.3', true],
  ['200', '1.2.4', true],
  ['200', '1.2.3-beta.1', false],
  ['404', '', false],
  ['503', '', false],
])(
  'keeps the beta-first guard on the standard feed: HTTP %s, version %s',
  (status, version, accepted) => {
    const dir = temp();
    stub(
      dir,
      'curl',
      `
    out=''; while [ "$#" -gt 0 ]; do
      if [ "$1" = '-o' ]; then out="$2"; shift 2; else url="$1"; shift; fi
    done
    printf '%s\\n' "$url" >> "$RUNNER_TEMP/urls"
    echo 'version: ${version}' > "$out"
    printf '%s' '${status}'
  `,
    );
    const result = shell(
      dir,
      step('release-stable', 'promote-to-stable', 'Verify version was promoted to beta').run!,
      {
        VERSION: '1.2.3',
        SKIP_BETA_CHECK: 'false',
      },
    );
    expect(result.status === 0, result.stdout + result.stderr).toBe(accepted);
    expect(readFileSync(join(dir, 'urls'), 'utf8').trim().split('\n')).toEqual([
      'https://github.com/intent-hq/cloudlands-releases/releases/download/beta/latest-mac.yml',
    ]);
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

it('rejects replay inputs that would build or select another backend', () => {
  const code = step(
    'manual-signed-build',
    'replay-isolated-macos',
    'Require proof-only inputs',
  ).run!;
  const env = {
    BUILD_MACOS: 'false',
    BUILD_WINDOWS: 'false',
    BUILD_LINUX: 'false',
    ISOLATED_TEST: 'false',
    SMOKE_MACOS: 'false',
    INTENTD_REF: '',
    SIGN: 'true',
  };
  const dir = temp();
  expect(shell(dir, code, env).status).toBe(0);
  for (const key of ['BUILD_MACOS', 'BUILD_WINDOWS', 'BUILD_LINUX', 'ISOLATED_TEST', 'SMOKE_MACOS'])
    expect(shell(dir, code, { ...env, [key]: 'true' }).status).not.toBe(0);
  expect(shell(dir, code, { ...env, INTENTD_REF: 'main' }).status).not.toBe(0);
  expect(shell(dir, code, { ...env, SIGN: 'false' }).status).not.toBe(0);
});

it('never allocates ordinary build or smoke jobs for a proof-only replay', () => {
  const jobs = workflow('manual-signed-build').jobs;
  for (const isolated_test of [false, true]) {
    const inputs = {
      isolated_replay: true,
      isolated_test,
      build_macos: true,
      build_windows: true,
      build_linux: true,
      smoke_macos: true,
    };
    for (const name of [
      'select-macos',
      'build-macos',
      'windows-signing-preflight',
      'build-windows',
      'build-linux',
      'smoke-inputs',
      'smoke-macos',
      'verify-isolated-macos',
    ]) {
      const expression = jobs[name].if!.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
      expect(runInNewContext(expression, { inputs }), name).toBe(false);
    }
  }
});

it.each(['14.0', '14.1', '15.1'])(
  'passes the immutable source protocol %s through the isolated proof job',
  (version) => {
    const jobs = workflow('manual-signed-build').jobs;
    const source = step(
      'manual-signed-build',
      'build-macos',
      'Resolve isolated protocol from selected daemon source',
    );
    expect(source.if).toBe('${{ inputs.isolated_test }}');
    expect(source.env).toEqual({
      BACKEND_SHA: '${{ steps.intentd_sha.outputs.sha }}',
      BACKEND_REF: '${{ inputs.intentd_ref }}',
    });
    expect(jobs['build-macos'].outputs?.isolated_protocol).toBe(
      '${{ steps.isolated_protocol.outputs.version }}',
    );
    const dir = temp();
    const backend = 'b'.repeat(40);
    const frontend = 'a'.repeat(40);
    stub(
      dir,
      'node',
      `printf '%s\\n' "$@" > "$RUNNER_TEMP/node-args"; printf 'version=%s\\n' '${version}'`,
    );
    const output = join(dir, 'source-output');
    expect(
      shell(dir, source.run!, { BACKEND_SHA: backend, BACKEND_REF: backend, GITHUB_OUTPUT: output })
        .status,
    ).toBe(0);
    expect(readFileSync(join(dir, 'node-args'), 'utf8').trim().split('\n')).toEqual([
      'scripts/isolated-package-protocol.mjs',
      'intentd-src',
      backend,
    ]);
    const selected = readFileSync(output, 'utf8').trim().split('=')[1]!;
    expect(selected).toBe(version);
    const proof = step(
      'manual-signed-build',
      'verify-isolated-macos',
      'Prove packaged isolation on disposable macOS',
    );
    const env = Object.fromEntries(
      Object.entries(proof.env!).map(([key, value]) => [
        key,
        render(value, {
          'inputs.intentd_ref': backend,
          'github.sha': frontend,
          'needs.build-macos.outputs.isolated_protocol': selected,
        }),
      ]),
    );
    mkdirSync(join(dir, 'isolated-package'));
    writeFileSync(join(dir, 'isolated-package/package.dmg'), 'owned fixture');
    expect(shell(dir, proof.run!, env).status).toBe(0);
    expect(readFileSync(join(dir, 'node-args'), 'utf8').trim().split('\n')).toEqual([
      'scripts/verify-isolated-macos-package.mjs',
      'isolated-package/package.dmg',
      'isolated-package-proof',
      backend,
      frontend,
      version,
    ]);
  },
);

it('rejects a resolved daemon identity different from the selected immutable ref before extraction', () => {
  const source = step(
    'manual-signed-build',
    'build-macos',
    'Resolve isolated protocol from selected daemon source',
  );
  const dir = temp();
  stub(dir, 'node', 'touch "$RUNNER_TEMP/extracted"');
  expect(
    shell(dir, source.run!, {
      BACKEND_SHA: 'a'.repeat(40),
      BACKEND_REF: 'b'.repeat(40),
      GITHUB_OUTPUT: join(dir, 'output'),
    }).status,
  ).not.toBe(0);
  expect(existsSync(join(dir, 'extracted'))).toBe(false);
});

// release-alpha rebuilds old tags with the workflow from the dispatch ref but the
// scripts from the tag. A step that calls a script newer than the tag passes the
// current-tree fixtures and fails only on a real rebuild (cloudlands-fe#3780).
const PNPM_BUILTINS = new Set(['install', 'i', 'add', 'exec', 'dlx', 'store', 'rebuild']);
const LEGACY_SKIPPED_CONDITION = "needs.resolve.outputs.native_macos == 'true'";
interface TagCall {
  job: string;
  step: string;
  target: string;
  kind: 'file' | 'package-script';
}
interface RunDefaults {
  defaults?: { run?: { 'working-directory'?: string } };
}
type TagStep = Step & { 'working-directory'?: string };
const SCRIPT_REF = /(?<![\w./-])(?:\.\/)?scripts\/[\w./-]*[\w-]/g;
const normalizeRef = (ref: string) => posix.normalize(ref.replace(/"/g, ''));
// True only for the exact native-only condition the oldest (legacy) tag skips;
// any other condition may run on that tag, so its calls are still checked.
function skippedOnLegacyTag(condition: string | undefined) {
  if (!condition) return false;
  return condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim() === LEGACY_SKIPPED_CONDITION;
}
// Script paths a run calls without a presence guard that protects that call.
// Deliberately strict: only these shapes count, and anything else is reported.
// - inside the file-present branch of a bare `if [ -f X ]` / `if [ ! -f X ]`
//   (the whole condition, nothing chained onto it);
// - after such a block whose file-missing branch itself runs `exec` or `exit`,
//   within the same enclosing branch (an outer `if` may skip the guard);
// - as an element of an array only probed by `for V in "${A[@]}" ... -f "$V"`,
//   which tests the files rather than calling them.
function unguardedRefs(run: string) {
  let text = run
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
  for (const [, variable, array] of text.matchAll(/\bfor (\w+) in "\$\{(\w+)\[@\]\}"/g)) {
    // Probe-only: the array feeds just this loop (no other `$A`/`${A...}` read;
    // `${#A[@]}` counts are harmless), and the loop variable appears
    // only as the operand of a `-f`/`-e` test, so no element is ever executed.
    const arrayUses = text.match(new RegExp(`\\$\\{?${array}\\b`, 'g'))?.length ?? 0;
    const variableUses = text.match(new RegExp(`\\$\\{?${variable}\\b`, 'g'))?.length ?? 0;
    const tests = text.match(new RegExp(`-[fe]\\s+"\\$\\{?${variable}\\}?"`, 'g'))?.length ?? 0;
    if (arrayUses !== 1 || tests === 0 || variableUses !== tests) continue;
    text = text.replace(new RegExp(`\\b${array}=\\([^)]*\\)`), `${array}=()`);
  }
  // One statement per line, so one-line `if ...; then ...; fi` scans like the block form.
  const lines = text
    .replace(/;\s*(then|else|elif|fi|do|done)\b/g, '\n$1')
    .replace(/\b(then|else|do)\s+(?=\S)/g, '$1\n')
    .replace(/^(\s*(?:fi|done))\s*(?:;|&&|\|\|)\s*/gm, '$1\n')
    .split('\n');
  const presence = /^\s*if\s+\[\s+(!\s+)?-[fe]\s+("?[\w./-]+"?)\s+\]\s*$/;
  interface Frame {
    target?: string;
    present: boolean;
    missingTerminates: boolean;
    // Files proven present by a closed terminating guard within this branch only.
    facts: Set<string>;
  }
  const frames: Frame[] = [];
  const rootFacts = new Set<string>();
  const facts = () => (frames.length ? frames[frames.length - 1].facts : rootFacts);
  const refs: string[] = [];
  for (const line of lines) {
    const opened = presence.exec(line);
    if (opened) {
      frames.push({
        target: normalizeRef(opened[2]),
        present: !opened[1],
        missingTerminates: false,
        facts: new Set(),
      });
      continue;
    }
    const top = frames[frames.length - 1];
    if (/^\s*if\b/.test(line)) {
      frames.push({ present: false, missingTerminates: false, facts: new Set() });
    } else if (/^\s*(?:else|elif)\b/.test(line) && top) {
      // elif makes the file-missing path conditional, so it never terminates for sure.
      if (/^\s*elif\b/.test(line)) top.target = undefined;
      top.present = !top.present;
      top.facts.clear();
    } else if (/^\s*fi\b/.test(line)) {
      const frame = frames.pop();
      if (frame?.target && frame.missingTerminates) facts().add(frame.target);
      continue;
    }
    if (top && !top.present && /^\s*(?:exec|exit)\b/.test(line)) top.missingTerminates = true;
    for (const [ref] of line.matchAll(SCRIPT_REF)) {
      const target = normalizeRef(ref);
      const guarded =
        rootFacts.has(target) ||
        frames.some((frame) => frame.facts.has(target)) ||
        frames.some((frame) => frame.present && frame.target === target);
      if (!guarded) refs.push(target);
    }
  }
  return refs;
}
// Calls into the tag checkout that the oldest tag cannot satisfy and nothing guards.
function unguardedTagCalls(wf: Workflow & RunDefaults, snapshot: TagSnapshot): TagCall[] {
  const calls: TagCall[] = [];
  for (const [job, definition] of Object.entries(wf.jobs)) {
    const { steps = [] } = definition;
    if (skippedOnLegacyTag(definition.if)) continue;
    const isCheckout = (s: Step) => s.uses?.startsWith('actions/checkout@') === true;
    const checkout = steps.findIndex(
      (s) =>
        isCheckout(s) &&
        String(s.with?.ref ?? '').startsWith('refs/tags/') &&
        posix.normalize(String(s.with?.path ?? '.')) === '.',
    );
    if (checkout < 0) continue;
    // Other checkouts (e.g. .release-tools) hold current tooling, not the tag.
    const otherRoots = steps
      .filter((s) => isCheckout(s) && s.with?.path)
      .map((s) => posix.normalize(String(s.with!.path)))
      .filter((root) => root !== '.');
    const jobCwd = (definition as Job & RunDefaults).defaults?.run?.['working-directory'];
    for (const s of steps.slice(checkout + 1) as TagStep[]) {
      if (!s.run || skippedOnLegacyTag(s.if)) continue;
      const cwd = posix.normalize(
        s['working-directory'] ?? jobCwd ?? wf.defaults?.run?.['working-directory'] ?? '.',
      );
      if (otherRoots.some((root) => cwd === root || cwd.startsWith(`${root}/`))) continue;
      for (const ref of unguardedRefs(s.run)) {
        const target = posix.join(cwd, ref);
        if (!snapshot.files.includes(target))
          calls.push({ job, step: s.name, target, kind: 'file' });
      }
      const run = s.run
        .split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n');
      for (const [, name] of run.matchAll(/\bpnpm\s+(?:run\s+)?([\w:-]+)/g)) {
        if (PNPM_BUILTINS.has(name)) continue;
        // A non-root cwd reads another package.json the snapshot does not cover.
        if (cwd === '.' && snapshot.packageScripts.includes(name)) continue;
        const target = cwd === '.' ? name : `${cwd}:${name}`;
        calls.push({ job, step: s.name, target, kind: 'package-script' });
      }
    }
  }
  const seen = new Set<string>();
  return calls.filter((c) => {
    const key = `${c.job}/${c.step}/${c.kind}/${c.target}`;
    return !seen.has(key) && seen.add(key);
  });
}

describe('release tag checkout compatibility with the oldest rebuildable tag', () => {
  it('routes the oldest tag down the legacy (non-native) Mac path', () => {
    for (const tool of nativeReleaseTools) expect(oldestTag.files).not.toContain(tool);
    const dir = temp();
    legacyCheckout(dir);
    expect(releasePlan(dir).native_macos).toBe('false');
  });

  it(`calls only scripts ${oldestTag.tag} has, or guards them with a presence check`, () => {
    const calls = unguardedTagCalls(workflow('release-alpha'), oldestTag);
    expect(
      calls,
      `These release-alpha steps run in the tag checkout but call scripts that ${oldestTag.tag} ` +
        'lacks. Guard each with `if [ -f scripts/<file> ]` (and keep the old behaviour in the ' +
        'fallback), or run it from .release-tools.',
    ).toEqual([]);
  });

  it('flags unguarded or wrongly guarded calls and accepts protected or skipped ones', () => {
    const wf = (steps: Step[], defaults?: string): Workflow =>
      ({
        jobs: {
          build: {
            ...(defaults ? { defaults: { run: { 'working-directory': defaults } } } : {}),
            steps: [
              { name: 'Checkout', uses: 'actions/checkout@v7', with: { ref: 'refs/tags/v1' } },
              { name: 'Tools', uses: 'actions/checkout@v7', with: { path: './.release-tools' } },
              ...steps,
            ],
          },
        },
      }) as unknown as Workflow;
    const snapshot: TagSnapshot = {
      tag: 'v1',
      commit: '',
      files: ['scripts/old.mjs'],
      packageScripts: ['build'],
    };
    const flagged = (steps: Step[], defaults?: string) =>
      unguardedTagCalls(wf(steps, defaults), snapshot).map((c) => `${c.step}:${c.target}`);
    expect(
      flagged([
        { name: 'New', run: 'node scripts/new.mjs\n# node scripts/commented.mjs\npnpm run fresh' },
        { name: 'Old', run: 'node ./scripts/old.mjs && pnpm run build && pnpm install' },
        // A presence test only guards the call it protects.
        {
          name: 'Unrelated',
          run: 'if [ -f scripts/new.mjs ]; then echo ok; fi; node scripts/new.mjs',
        },
        { name: 'Else', run: 'if [ -f scripts/new.mjs ]; then :; else node scripts/new.mjs; fi' },
        {
          name: 'Falls',
          run: 'if [ ! -f scripts/new.mjs ]; then echo no; fi\nnode scripts/new.mjs',
        },
        { name: 'Dot', 'working-directory': './', run: 'node scripts/new.mjs' } as Step,
        { name: 'Inline', run: '[ -f scripts/new.mjs ] && echo ok; node scripts/new.mjs' },
        {
          name: 'Nested',
          run: 'if [ "$C" = y ]; then\n  if [ ! -f scripts/new.mjs ]; then\n    exit 1\n  fi\nfi\nnode scripts/new.mjs',
        },
        {
          name: 'ProbeRuns',
          run: 'T=(scripts/new.mjs)\nfor X in "${T[@]}"; do\n  if [ -f "$X" ]; then\n    echo ok\n  fi\n  node "$X"\ndone',
        },
        {
          name: 'ArrayRuns',
          run: 'T=(scripts/new.mjs)\nfor X in "${T[@]}"; do\n  [ -f "$X" ] && n=1\ndone\nnode "$T"',
        },
        {
          name: 'Chained',
          run: 'if [ -f scripts/new.mjs ] || true; then node scripts/new.mjs; fi',
        },
        {
          name: 'Branches',
          run: 'if [ -f scripts/new.mjs ]; then\n  exec node scripts/new.mjs\nelse\n  echo missing\nfi\nnode scripts/new.mjs',
        },
        {
          name: 'Either',
          if: "needs.resolve.outputs.native_macos == 'true' || needs.resolve.outputs.native_macos == 'false'",
          run: 'bash scripts/native.sh',
        },
      ]),
    ).toEqual([
      'New:scripts/new.mjs',
      'New:fresh',
      'Unrelated:scripts/new.mjs',
      'Else:scripts/new.mjs',
      'Falls:scripts/new.mjs',
      'Dot:scripts/new.mjs',
      'Inline:scripts/new.mjs',
      'Nested:scripts/new.mjs',
      'ProbeRuns:scripts/new.mjs',
      'ArrayRuns:scripts/new.mjs',
      'Chained:scripts/new.mjs',
      'Branches:scripts/new.mjs',
      'Either:scripts/native.sh',
    ]);
    expect(flagged([{ name: 'Sub', run: 'node scripts/old.mjs' }], 'src')).toEqual([
      'Sub:src/scripts/old.mjs',
    ]);
    expect(
      flagged([
        {
          name: 'Fallback',
          run: 'if [ ! -f scripts/new.mjs ]; then exec pnpm run build; fi\nexec node scripts/new.mjs',
        },
        { name: 'Then', run: 'if [ -f scripts/new.mjs ]; then\n  node scripts/new.mjs\nfi' },
        {
          name: 'ElseExits',
          run: 'if [ -f scripts/new.mjs ]; then\n  echo ok\nelse\n  exit 1\nfi\nnode scripts/new.mjs',
        },
        {
          name: 'Probe',
          run: 'T=(scripts/a.mjs scripts/b.sh)\nfor X in "${T[@]}"; do [ -f "$X" ] && n=1; done',
        },
        {
          name: 'Native',
          if: "${{ needs.resolve.outputs.native_macos == 'true' }}",
          run: 'bash scripts/native.sh',
        },
        {
          name: 'Tools',
          'working-directory': '.release-tools/',
          run: 'node scripts/x.mjs',
        } as Step,
      ]),
    ).toEqual([]);
  });

  // Keeps the committed snapshot honest wherever the tag is fetchable (full clones).
  const tagCommit = spawnSync('git', ['rev-parse', '-q', '--verify', `${oldestTag.tag}^{commit}`], {
    encoding: 'utf8',
  });
  it.runIf(tagCommit.status === 0)(`snapshot matches the ${oldestTag.tag} tree`, () => {
    expect(tagCommit.stdout.trim()).toBe(oldestTag.commit);
    const git = (...args: string[]) =>
      spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
    expect(oldestTag.files).toEqual(
      git('ls-tree', '-r', '--name-only', oldestTag.commit, 'scripts/').trim().split('\n').sort(),
    );
    expect(oldestTag.packageScripts).toEqual(
      Object.keys(JSON.parse(git('show', `${oldestTag.commit}:package.json`)).scripts).sort(),
    );
  });
});
