// @verify-changed-triggers: scripts/*retire-obsolete-merge-runs*.py, scripts/retirement-test-isolation.py, .github/workflows/retire-obsolete-merge-runs.yml, .github/workflows/intent-pr.yml
// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');
const workflow = (name: string) => load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));

describe('obsolete merge-run retirement', () => {
  it.each(['test-retire-obsolete-merge-runs.py', 'test-retire-obsolete-merge-runs-caller.py'])(
    'executes offline policy and caller regressions: %s',
    (file) => {
      const result = spawnSync('python3', ['-I', '-B', `scripts/${file}`], {
        encoding: 'utf8',
        timeout: 30_000,
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
    },
  );

  it('limits cleanup to trusted main on hosted Linux with job-scoped cancellation', () => {
    const cleanup = workflow('retire-obsolete-merge-runs');
    expect(Object.keys(cleanup.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(cleanup.on.schedule).toEqual([{ cron: '13,43 * * * *' }]);
    expect(cleanup.on.workflow_dispatch.inputs.mode.default).toBe('dry-run');
    expect(cleanup.on.workflow_dispatch.inputs.mode.options).toEqual(['dry-run', 'apply']);
    expect(cleanup.permissions).toEqual({});
    expect(cleanup.concurrency).toEqual({
      group: 'retire-obsolete-merge-runs',
      'cancel-in-progress': false,
    });
    const job = cleanup.jobs.cleanup;
    expect(job['runs-on']).toBe('ubuntu-latest');
    expect(job.if).toBe(
      "github.repository == 'intent-hq/cloudlands-fe' && github.ref == 'refs/heads/main'",
    );
    expect(job.permissions).toEqual({ contents: 'read', actions: 'write' });
    const checkout = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/checkout@'),
    );
    expect(checkout.with).toMatchObject({ ref: 'refs/heads/main', 'persist-credentials': false });
    const execute = job.steps.find((step: { id?: string }) => step.id === 'retire');
    expect(execute.env.GH_TOKEN).toBe('${{ github.token }}');
    expect(execute.env.RETIREMENT_READ_TOKEN).toBe('${{ secrets.CI_QUEUE_READ_TOKEN }}');
    expect(execute.env.MODE).toBe(
      "${{ github.event_name == 'schedule' && 'apply' || inputs.mode }}",
    );
    expect(execute.run).toContain('retire-obsolete-merge-runs-caller.py');
    expect(execute.run).toContain('--state .retirement/cursor.json');
    expect(execute.run).toContain('"--$MODE"');
    expect(execute.run).toContain('--probe-run-id "$PROBE_RUN_ID"');
    const save = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/cache/save@'),
    );
    expect(save.if).toContain('always()');
    expect(save.with.path).toBe('.retirement/cursor.json');
    const restore = job.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith('actions/cache/restore@'),
    );
    expect(restore.with.key).toBe(save.with.key);
    expect(restore.with['restore-keys']).toBe(
      "retirement-v1-${{ github.event_name == 'schedule' && 'apply' || inputs.mode }}-",
    );
  });

  it('keeps existing concurrency and removes temporary PR credential probes', () => {
    const ci = workflow('intent-pr');
    expect(ci.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.head_ref || github.run_id }}',
      'cancel-in-progress': true,
    });
    expect(ci.on).toHaveProperty('merge_group');
    expect(ci.jobs).not.toHaveProperty('retirement-access-probe');
    expect(ci.jobs).not.toHaveProperty('retirement-existing-read-probe');
  });
});
