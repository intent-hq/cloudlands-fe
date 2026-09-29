// @verify-changed-triggers: .github/workflows/*.yml
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = (name: string) => readFileSync(`.github/workflows/${name}.yml`, 'utf8');
const lock =
  /^( *)concurrency:\n\1  group: cloudlands-release\n\1  cancel-in-progress: false\n\1  queue: max$/m;
const writers = ['release-alpha', 'promote-beta', 'release-stable', 'release-please'];

describe('prerelease cleanup writer coordination', () => {
  it.each(writers)('%s holds the shared lock and retains pending writers', (name) => {
    const source = workflow(name);
    expect(source).toMatch(lock);
    expect(source.match(/^ *concurrency:/gm)).toHaveLength(1);
    if (name === 'release-please') {
      expect(source.match(/^  [\w-]+:/gm)).toEqual(['  push:', '  release-please:']);
      expect(source).toMatch(/^    concurrency:/m);
    } else {
      expect(source.indexOf('concurrency:')).toBeLessThan(source.indexOf('\njobs:'));
    }
    expect(source).not.toMatch(/^ *uses: .*\.github\/workflows\//m);
    // Dispatching downstream builds is asynchronous; never wait while holding the lock.
    expect(source).not.toMatch(/gh (run watch|workflow run[^\n]*--wait)/);
  });

  it('covers all workflows that mutate release records or assets', () => {
    const releaseWriter =
      /gh release (?:create|upload|edit|delete|delete-asset)\b|uses: googleapis\/release-please-action@/;
    const found = readdirSync('.github/workflows')
      .filter((file) => file.endsWith('.yml'))
      .filter((file) => releaseWriter.test(workflow(file.slice(0, -4))))
      .map((file) => file.slice(0, -4));
    expect(found.sort()).toEqual([...writers].sort());
  });

  it('holds the cleanup lock across inventory and deletion, without a nested job lock', () => {
    const source = workflow('cleanup-prereleases');
    expect(source).toMatch(lock);
    expect(source.match(/^ *concurrency:/gm)).toHaveLength(1);
    expect(source.indexOf('concurrency:')).toBeLessThan(source.indexOf('\njobs:'));
    expect(source).not.toMatch(/^ *uses: .*\.github\/workflows\//m);
  });

  it('defaults manual runs to preview and schedules the component daily', () => {
    const source = workflow('cleanup-prereleases');
    expect(source).toMatch(
      /mode:\n\s+description:.*\n\s+type: choice\n\s+default: preview\n\s+options: \[preview, apply\]/,
    );
    expect(source).toContain("cron: '17 2 * * *'");
    expect(source).toContain(
      "github.repository == 'intent-hq/cloudlands-fe' && github.ref == 'refs/heads/main'",
    );
  });

  it('uses a reviewed immutable script with minimum checkout permissions', () => {
    const source = workflow('cleanup-prereleases');
    expect(source).toMatch(/^permissions: \{\}$/m);
    expect(source).toContain('repository: intent-hq/intent');
    expect(source).toMatch(/^          ref: [a-f0-9]{40}$/m);
    expect(source).toContain('ref: 3cd2e23e904051f8a0c047717fe7a8e843a5c4ea');
    expect(source).toContain('persist-credentials: false');
    expect(source).toContain('submodules: false');
    expect(source).toContain('token: ${{ secrets.PRERELEASE_CLEANUP_TOKEN }}');
    expect(source).toContain('GH_TOKEN: ${{ secrets.PRERELEASE_CLEANUP_TOKEN }}');
    expect(source).toContain('CLEANUP_ENABLED: ${{ vars.PRERELEASE_CLEANUP_ENABLED }}');
    expect(source).toContain('EVENT_NAME: ${{ github.event_name }}');
    expect(source).toContain('REQUESTED_MODE: ${{ inputs.mode }}');
    expect(source).not.toContain('secrets.GITHUB_TOKEN');
    expect(source).not.toMatch(/continue-on-error: true|permissions:\n/);
    expect(source).toContain('if: always()');
    expect(source).toContain('path: cleanup-audit.json');
  });
});

// Execute the actual workflow shell with stubbed Python: no network or deletion.
function runCleanup(event: string, mode: string, enabled: string, token = 'test-token', exit = 0) {
  const source = workflow('cleanup-prereleases');
  const run = source.match(
    /      - name: Run cleanup\n[\s\S]*?        run: \|\n([\s\S]*?)(?=\n      - name:|$)/,
  )?.[1];
  expect(run).toBeDefined();
  const dir = mkdtempSync(join(tmpdir(), 'cleanup-workflow-'));
  try {
    writeFileSync(
      join(dir, 'python3'),
      `#!/bin/bash\nprintf '%s\\n' "$@" > "$CALL_LOG"\nprintf '{"audit":true}\\n'\nexit ${exit}\n`,
      { mode: 0o755 },
    );
    const result = spawnSync(
      'bash',
      ['-e', '-o', 'pipefail', '-c', run!.replace(/^          /gm, '')],
      {
        cwd: dir,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GH_TOKEN: token,
          CLEANUP_ENABLED: enabled,
          EVENT_NAME: event,
          REQUESTED_MODE: mode,
          CALL_LOG: join(dir, 'calls'),
        },
      },
    );
    const files = readdirSync(dir);
    return {
      ...result,
      args: files.includes('calls')
        ? readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n')
        : [],
      audit: files.includes('cleanup-audit.json')
        ? readFileSync(join(dir, 'cleanup-audit.json'), 'utf8')
        : '',
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('cleanup dispatch safety', () => {
  it.each([
    ['workflow_dispatch', 'preview', ''],
    ['workflow_dispatch', 'preview', 'true'],
    ['schedule', '', ''],
    ['schedule', '', 'false'],
  ])('previews %s / %s / enabled=%s', (event, mode, enabled) => {
    const result = runCleanup(event, mode, enabled);
    expect(result.status).toBe(0);
    expect(result.args).toEqual([
      '-S',
      '-B',
      'cleanup-source/scripts/cleanup_prereleases.py',
      '--component',
      'cloudlands-fe',
    ]);
    expect(result.audit).toContain('"audit":true');
  });

  it.each(['workflow_dispatch', 'schedule'])('applies %s only after activation', (event) => {
    const result = runCleanup(event, event === 'schedule' ? '' : 'apply', 'true');
    expect(result.status).toBe(0);
    expect(result.args).toEqual([
      '-S',
      '-B',
      'cleanup-source/scripts/cleanup_prereleases.py',
      '--component',
      'cloudlands-fe',
      '--apply',
    ]);
    // Omitting --max-delete preserves the reviewed command's default batch of 20.
  });

  it('refuses manual apply before activation without invoking cleanup', () => {
    const result = runCleanup('workflow_dispatch', 'apply', '');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('PRERELEASE_CLEANUP_ENABLED');
    expect(result.args).toEqual([]);
  });

  it('rejects unexpected dispatch modes without invoking cleanup', () => {
    const result = runCleanup('workflow_dispatch', 'unknown', 'true');
    expect(result.status).not.toBe(0);
    expect(result.args).toEqual([]);
  });

  it('fails without a credential and never invokes cleanup', () => {
    const result = runCleanup('workflow_dispatch', 'apply', 'true', '');
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('PRERELEASE_CLEANUP_TOKEN');
    expect(result.args).toEqual([]);
  });

  it('preserves a failed command exit and its audit', () => {
    const result = runCleanup('workflow_dispatch', 'apply', 'true', 'test-token', 1);
    expect(result.status).toBe(1);
    expect(result.audit).toContain('"audit":true');
  });
});
