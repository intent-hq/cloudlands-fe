// @vitest-environment node
// @verify-changed-triggers: .github/workflows/intent-pr.yml, scripts/run-ct-tests.mjs, scripts/ct-browser.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nonFontPackagesFromDryRun } from './playwright-os-deps-lib.mjs';

const root = resolve(__dirname, '..');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const workflow = readFileSync(join(root, '.github/workflows/intent-pr.yml'), 'utf8');
const ctJob = workflow.split('\n  test-ct:')[1].split(/\n  [\w-]+:/)[0];
function step(name: string) {
  return ctJob.split(`      - name: ${name}\n`)[1].split('\n      - name:')[0];
}
function runBlock(name: string) {
  return step(name)
    .split('        run: |\n')[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n');
}

describe('CT launcher provisioning', () => {
  it('executes the CI identity step against the runner cache and feeds the cache action and marker', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'ct-ci-plan-'));
    dirs.push(dir);
    const output = join(dir, 'output');
    const env = {
      ...process.env,
      DD_TRACE_STARTUP_LOGS: 'false',
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: output,
      PLAYWRIGHT_BROWSERS_PATH: join(dir, 'slot-8'),
    };
    const result = spawnSync(
      'bash',
      ['-euo', 'pipefail', '-c', runBlock('Resolve CT browser identity and paths')],
      { cwd: root, env, encoding: 'utf8' },
    );
    expect(result.stderr).not.toContain('Error');
    expect(result.status).toBe(0);
    const outputs = Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    const expand = (value: string) =>
      value
        .replace(/\$\{\{ steps.ct-browser.outputs.([\w-]+) \}\}/g, (_, key) => outputs[key])
        .replace('${{ runner.os }}', 'Linux')
        .replace('${{ runner.arch }}', 'X64');
    const cacheStep = step('Cache Playwright browsers');
    const cache = {
      path: cacheStep.match(/          path: (.*)/)![1],
      key: cacheStep.match(/          key: (.*)/)![1],
    };
    expect(expand(cache.path)).toBe(join(dir, 'slot-8'));
    expect(expand(cache.key)).toBe(
      'playwright-browsers-Linux-X64-ct-1.58.2-pw-1.63.0-chromium-153.0.8010.12-r1243',
    );
    expect(outputs['readiness-marker']).toBe(
      join(dir, 'slot-8', '.with-deps-ct-1.58.2-pw-1.63.0-chromium-153.0.8010.12-r1243'),
    );
    const plan = JSON.parse(readFileSync(join(dir, 'ct-browser-plan.json'), 'utf8'));
    const installed = execFileSync(
      process.execPath,
      ['scripts/run-ct-tests.mjs', '--install-browsers', '--dry-run', 'chromium'],
      { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(installed).toContain('153.0.8010.12');
    expect(installed).toContain(join(dir, 'slot-8', 'chromium_headless_shell-1243'));
    expect(installed).not.toContain('1208');
    const deps = execFileSync(
      process.execPath,
      ['scripts/run-ct-tests.mjs', '--print-os-deps', 'chromium'],
      { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .trim()
      .split(' ')
      .filter(Boolean);
    const supplierDeps = spawnSync(process.execPath, [plan.osDeps.cliPath, ...plan.osDeps.args], {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(deps).toEqual(nonFontPackagesFromDryRun(supplierDeps.stdout, supplierDeps.status));
    expect(deps.some((pkg) => /^(fonts-|xfonts-)/.test(pkg))).toBe(false);

    // Execute the real marker branch without downloading or invoking sudo/apt.
    // A warm runner still installs the browser; only successful OS provisioning
    // may publish readiness for the newly selected identity.
    const bin = join(dir, 'bin');
    const calls = join(dir, 'calls');
    mkdirSync(bin);
    mkdirSync(env.PLAYWRIGHT_BROWSERS_PATH);
    writeFileSync(
      join(bin, 'node'),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CT_INSTALL_CALLS"\nexit "${CT_INSTALL_STATUS:-0}"\n',
      { mode: 0o755 },
    );
    writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const installEnv = { ...env, PATH: `${bin}:${env.PATH}`, CT_INSTALL_CALLS: calls };
    const provision = (status = '0') =>
      spawnSync(
        'bash',
        ['-euo', 'pipefail', '-c', expand(runBlock('Install Playwright browsers (tinybox)'))],
        { cwd: root, env: { ...installEnv, CT_INSTALL_STATUS: status }, encoding: 'utf8' },
      );
    expect(provision().status).toBe(0);
    expect(existsSync(outputs['readiness-marker'])).toBe(true);
    expect(provision().status).toBe(0);
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual([
      'scripts/run-ct-tests.mjs --install-browsers --with-deps chromium',
      'scripts/run-ct-tests.mjs --install-browsers chromium',
    ]);
    rmSync(outputs['readiness-marker']);
    expect(provision('1').status).toBe(1);
    expect(existsSync(outputs['readiness-marker'])).toBe(false);
  });
});
