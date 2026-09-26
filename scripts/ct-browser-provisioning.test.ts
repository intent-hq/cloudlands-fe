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

// Match the expression evaluation used by ct-contract-paths-ci.test.ts. Read
// the actual job/step conditions so a runner-only change cannot pass this test.
function evaluate(expression: string, context: Record<string, string>): unknown {
  let source = expression.replace(/^\$\{\{\s*/, '').replace(/\s*\}\}$/, '');
  source = source.replaceAll('!cancelled()', 'true');
  for (const [key, value] of Object.entries(context)) {
    source = source.replaceAll(key, JSON.stringify(value));
  }
  source = source.replaceAll('!=', ' NE ').replaceAll('==', '===').replaceAll(' NE ', '!==');
  const residue = source.replace(
    /"(?:\\.|[^"\\])*"|'[^']*'|true|false|fromJSON|===|!==|&&|\|\||[()\s]/g,
    '',
  );
  if (residue !== '') throw new Error(`unsupported workflow expression: ${residue}`);
  return new Function('fromJSON', `return (${source});`)(JSON.parse);
}

describe('required CT hosted routing', () => {
  it.each([
    ['pull_request', 'false'],
    ['pull_request', 'true'],
    ['merge_group', 'false'],
    ['merge_group', 'true'],
  ])('uses hosted provisioning on %s with global linux_burst=%s', (event, burst) => {
    const context = {
      'github.event_name': event,
      'needs.route.result': 'success',
      'needs.route.outputs.linux_burst': burst,
      'needs.route.outputs.linux_labels': JSON.stringify(
        burst === 'true' ? ['gh-linux-8x'] : ['self-hosted', 'linux', 'tinybox'],
      ),
      'needs.release-fast-path.outputs.fast_path': 'false',
      'needs.release-fast-path.outputs.ct_required': event === 'pull_request' ? 'true' : '',
    };
    const value = (scalar: string) =>
      scalar.startsWith('${{') ? evaluate(scalar, context) : scalar.replace(/^(['"])(.*)\1$/, '$2');
    expect(evaluate(ctJob.match(/^    if: (.*)$/m)![1], context)).toBe(true);
    const runner = value(ctJob.match(/^    runs-on: (.*)$/m)![1]);
    expect.soft(Array.isArray(runner) ? runner : [runner]).toEqual(['gh-linux-8x']);
    expect.soft(value(step('Setup Node.js').match(/^          cache: (.*)$/m)![1])).toBe('pnpm');

    const provisioning = ctJob.split('      - name: Build CT bundle')[0];
    const activeSteps = [...provisioning.matchAll(/^      - name: (.*)$/gm)]
      .map((match) => match[1])
      .filter((name) => evaluate(step(name).match(/^        if: (.*)$/m)?.[1] ?? 'true', context));
    for (const name of [
      'Resolve CT browser identity and paths',
      'Cache Playwright browsers',
      'Harden apt against mirror stalls',
      'Install Playwright browsers',
    ]) {
      expect.soft(activeSteps).toContain(name);
    }
    expect.soft(activeSteps).not.toContain('Point Playwright at per-slot paths (tinybox)');
    expect.soft(activeSteps).not.toContain('Install Playwright browsers (tinybox)');
  });
});

describe('CT launcher provisioning', () => {
  it.runIf(process.platform === 'linux')('runs the Linux CI cache and provisioning steps', () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'ct-ci-plan-'));
    dirs.push(dir);
    const output = join(dir, 'output');
    const env = {
      ...process.env,
      DD_TRACE_STARTUP_LOGS: 'false',
      RUNNER_TEMP: dir,
      GITHUB_OUTPUT: output,
      PLAYWRIGHT_BROWSERS_PATH: join(dir, 'browsers'),
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
    expect(expand(cache.path)).toBe(join(dir, 'browsers'));
    expect(expand(cache.key)).toBe(
      'playwright-browsers-Linux-X64-ct-1.58.2-pw-1.63.0-chromium-153.0.8010.12-r1243',
    );
    expect(outputs['readiness-marker']).toBe(
      join(dir, 'browsers', '.with-deps-ct-1.58.2-pw-1.63.0-chromium-153.0.8010.12-r1243'),
    );
    const plan = JSON.parse(readFileSync(join(dir, 'ct-browser-plan.json'), 'utf8'));
    const installed = execFileSync(
      process.execPath,
      ['scripts/run-ct-tests.mjs', '--install-browsers', '--dry-run', 'chromium'],
      { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(installed).toContain('153.0.8010.12');
    expect(installed).toContain(join(dir, 'browsers', 'chromium_headless_shell-1243'));
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
  });
});

describe.runIf(process.platform === 'linux')('hosted CT provisioning failures', () => {
  // Execute the real workflow shell with stubbed external commands. No browser
  // downloads, host package queries, sudo, apt, or retry sleeps run locally.
  function provision(overrides: Record<string, string> = {}) {
    const dir = mkdtempSync(join(os.tmpdir(), 'ct-hosted-provision-'));
    dirs.push(dir);
    const bin = join(dir, 'bin');
    const calls = join(dir, 'calls');
    mkdirSync(bin);
    const stub = (name: string, body: string) =>
      writeFileSync(
        join(bin, name),
        `#!/bin/sh\nprintf '${name} %s\\n' "$*" >> "$CT_INSTALL_CALLS"\n${body}\n`,
        { mode: 0o755 },
      );
    stub(
      'node',
      `case "$*" in
  'scripts/run-ct-tests.mjs --install-browsers chromium') exit "$CT_BROWSER_STATUS" ;;
  'scripts/run-ct-tests.mjs --print-os-deps chromium')
    echo 'libpresent libmissing'
    exit "$CT_DEPS_STATUS" ;;
  *) exit 99 ;;
esac`,
    );
    stub('dpkg-query', '[ "$3" = "$CT_MISSING_PACKAGE" ] && exit 1\necho "install ok installed"');
    stub(
      'sudo',
      `case "$*" in
  'apt-get update') exit "$CT_UPDATE_STATUS" ;;
  'apt-get install -y --no-install-recommends libmissing')
    if [ "$CT_INSTALL_FAIL_ONCE" = 1 ] && [ ! -f "$CT_INSTALL_CALLS.failed" ]; then
      touch "$CT_INSTALL_CALLS.failed"
      exit 1
    fi
    exit "$CT_APT_STATUS" ;;
  *) exit 99 ;;
esac`,
    );
    stub('sleep', 'exit 0');
    const result = spawnSync(
      'bash',
      ['-euo', 'pipefail', '-c', runBlock('Install Playwright browsers')],
      {
        cwd: dir,
        env: {
          PATH: `${bin}:${process.env.PATH}`,
          CT_INSTALL_CALLS: calls,
          CT_BROWSER_STATUS: '0',
          CT_DEPS_STATUS: '0',
          CT_MISSING_PACKAGE: '',
          CT_UPDATE_STATUS: '0',
          CT_APT_STATUS: '0',
          CT_INSTALL_FAIL_ONCE: '0',
          ...overrides,
        },
        encoding: 'utf8',
      },
    );
    return {
      ...result,
      calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
    };
  }

  const browser = 'node scripts/run-ct-tests.mjs --install-browsers chromium';
  const deps = 'node scripts/run-ct-tests.mjs --print-os-deps chromium';
  const queries = [
    'dpkg-query -W -f=${Status} libpresent',
    'dpkg-query -W -f=${Status} libmissing',
  ];
  const update = 'sudo apt-get update';
  const install = 'sudo apt-get install -y --no-install-recommends libmissing';

  it('uses the pinned launcher and avoids apt when libraries are installed', () => {
    const result = provision();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.calls).toEqual([browser, deps, ...queries]);
  });

  it('installs only a missing library', () => {
    const result = provision({ CT_MISSING_PACKAGE: 'libmissing' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.calls).toEqual([browser, deps, ...queries, update, install]);
  });

  it('stops when the browser installation fails', () => {
    const result = provision({ CT_BROWSER_STATUS: '7' });
    expect(result.status).toBe(7);
    expect(result.calls).toEqual([browser]);
  });

  it('rejects a failed dependency report even if it printed packages', () => {
    const result = provision({ CT_DEPS_STATUS: '1' });
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([browser, deps]);
  });

  it.each(['CT_UPDATE_STATUS', 'CT_APT_STATUS'])('fails after bounded %s retries', (failure) => {
    const result = provision({ CT_MISSING_PACKAGE: 'libmissing', [failure]: '1' });
    const attempt = failure === 'CT_UPDATE_STATUS' ? [update] : [update, install];
    expect(result.status).toBe(1);
    expect(result.calls).toEqual([browser, deps, ...queries, ...attempt, 'sleep 15', ...attempt]);
  });

  it('accepts successful provisioning on the second attempt', () => {
    const result = provision({ CT_MISSING_PACKAGE: 'libmissing', CT_INSTALL_FAIL_ONCE: '1' });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.calls).toEqual([
      browser,
      deps,
      ...queries,
      update,
      install,
      'sleep 15',
      update,
      install,
    ]);
  });
});
