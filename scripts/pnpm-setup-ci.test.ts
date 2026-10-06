// @verify-changed-triggers: .github/workflows/intent-pr.yml
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { load } = require('js-yaml');

interface Step {
  name: string;
  id?: string;
  uses?: string;
  if?: string;
  with?: Record<string, unknown>;
  'continue-on-error'?: boolean;
}

const workflow = load(readFileSync('.github/workflows/intent-pr.yml', 'utf8'));
const steps: Step[] = workflow.jobs.checks.steps;

type Outcome = 'success' | 'failure' | 'cancelled';

/**
 * Interpret the actual checks-job step conditions and failure propagation.
 * Only the external setup action is substituted: it returns the supplied
 * outcomes, representing registry recovery or persistent signature refusal.
 * This tests workflow recovery, not pnpm's own cryptographic validator.
 */
function runSetup(outcomes: Outcome[]) {
  const context: Record<string, { outcome: Outcome; conclusion: Outcome }> = {};
  const calls: Step[] = [];
  const reached: string[] = [];
  let status: Outcome = 'success';
  for (const step of steps) {
    const expression = step.if?.replace(/^\$\{\{\s*|\s*\}\}$/g, '') ?? 'true';
    // GitHub implicitly adds success() unless a status function is present.
    const hasStatusFunction = /\b(success|failure|cancelled|always)\(/.test(expression);
    const enabled = runInNewContext(expression, {
      steps: context,
      success: () => status === 'success',
      failure: () => status === 'failure',
      cancelled: () => status === 'cancelled',
      always: () => true,
    });
    if ((!hasStatusFunction && status !== 'success') || !enabled) continue;
    reached.push(step.name);
    if (!step.uses?.startsWith('pnpm/action-setup@')) continue;
    const outcome = outcomes[calls.length];
    if (!outcome) throw new Error('Setup retried beyond the supplied attempt budget');
    calls.push(step);
    const conclusion =
      outcome === 'failure' && step['continue-on-error'] === true ? 'success' : outcome;
    if (step.id) context[step.id] = { outcome, conclusion };
    if (conclusion !== 'success') status = conclusion;
  }
  return { calls, reached, status };
}

const gates = ['Cold-checkout gates', 'Svelte check', 'Type check (renderer)'];

describe('Type Check & Lint pnpm setup recovery', () => {
  it('reaches lint and types after a transient identity-fetch failure recovers', () => {
    const result = runSetup(['failure', 'success']);
    expect(result.status).toBe('success');
    expect(result.calls).toHaveLength(2);
    expect(result.reached).toEqual(expect.arrayContaining(gates));
  });

  it.each(['persistent network outage', 'permanent signature identity mismatch'])(
    'fails closed after two attempts for %s',
    () => {
      const result = runSetup(['failure', 'failure']);
      expect(result.status).toBe('failure');
      expect(result.calls).toHaveLength(2);
      expect(result.reached).not.toContain('Install dependencies');
      for (const gate of gates) expect(result.reached).not.toContain(gate);
    },
  );

  it('does not retry a successful setup', () => {
    const result = runSetup(['success']);
    expect(result.status).toBe('success');
    expect(result.calls).toHaveLength(1);
    expect(result.reached).toEqual(expect.arrayContaining(gates));
  });

  it('does not retry or run gates after cancellation', () => {
    const result = runSetup(['cancelled']);
    expect(result.status).toBe('cancelled');
    expect(result.calls).toHaveLength(1);
    expect(result.reached).not.toContain('Install dependencies');
    for (const gate of gates) expect(result.reached).not.toContain(gate);
  });

  it('replays the full validating action with the same pin and isolated destination', () => {
    const { calls } = runSetup(['failure', 'success']);
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.uses).toBe('pnpm/action-setup@v6');
      expect(call.with).toEqual({
        version: '10.30.3',
        run_install: false,
        dest: '~/setup-pnpm-${{ runner.name }}',
      });
    }
  });
});
