// @verify-changed-triggers: .github/workflows/intent-pr.yml, .github/workflows/nightly-shifted-clock-unit-tests.yml
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = require('js-yaml');

type Step = { name?: string; uses?: string; with?: Record<string, unknown>; run?: string };
type Job = {
  'timeout-minutes': number;
  env: Record<string, string>;
  strategy: { matrix: { shard: number[] } };
  steps: Step[];
};
const job = (file: string, id: string): Job =>
  (load(readFileSync(`.github/workflows/${file}`, 'utf8')) as { jobs: Record<string, Job> }).jobs[
    id
  ];

const prJob = job('intent-pr.yml', 'test');
const nightlyJob = job('nightly-shifted-clock-unit-tests.yml', 'test-unit');

// Steps the PR job needs only for PR-relative baselines (LINT_BASELINE_BASE_REF).
const PR_ONLY_STEPS = new Set(['Fetch baseline comparison commit']);
const PR_ONLY_ENV = new Set(['LINT_BASELINE_BASE_REF']);
const NIGHTLY_ONLY_ENV = new Set(['VITEST_SHIFTED_NOW']);

// The nightly copies the PR unit job instead of reusing it (the PR job is wired into the
// required gate's routing); this keeps the copy from drifting when prerequisites change.
describe('nightly shifted-clock unit workflow mirrors the PR unit job', () => {
  it('runs the same setup steps with the same actions and inputs', () => {
    const shape = (steps: Step[]) =>
      steps.slice(0, -1).map(({ name, uses, with: inputs, run }) => ({ name, uses, inputs, run }));
    expect(shape(nightlyJob.steps)).toEqual(
      shape(prJob.steps.filter((step) => !PR_ONLY_STEPS.has(step.name ?? ''))),
    );
  });

  it('runs the same shard command and only adds the shifted clock to the environment', () => {
    const lastRun = (steps: Step[]) => steps.at(-1)?.run ?? '';
    const shardCommand = /^\s*pnpm run test:unit --shard=.*$/m;
    expect(lastRun(nightlyJob.steps).match(shardCommand)?.[0]).toBe(
      lastRun(prJob.steps).match(shardCommand)?.[0],
    );
    expect(lastRun(nightlyJob.steps)).toContain('node scripts/transfer-selection-fixtures.mjs');

    const without = (env: Record<string, string>, skip: Set<string>) =>
      Object.fromEntries(Object.entries(env).filter(([key]) => !skip.has(key)));
    expect(without(nightlyJob.env, NIGHTLY_ONLY_ENV)).toEqual(without(prJob.env, PR_ONLY_ENV));
    expect(nightlyJob.env.VITEST_SHIFTED_NOW).toBe("${{ inputs.shifted_now || '23:30' }}");
  });

  it('uses the same shard matrix and time budget', () => {
    expect(nightlyJob.strategy.matrix.shard).toEqual(prJob.strategy.matrix.shard);
    expect(nightlyJob['timeout-minutes']).toBe(prJob['timeout-minutes']);
  });
});
