// @verify-changed-triggers: .github/workflows/*.yml, scripts/setup-depot-sccache.py, scripts/runner-policy.test.cjs, scripts/test_runner_policy.py
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const require = createRequire(createRequire(import.meta.url).resolve('electron-updater'));
const { load } = require('js-yaml');
const read = (path: string) => load(readFileSync(path, 'utf8'));

describe('Depot CI runners', () => {
  it('routes every workload with tested self-hosted preference and Depot fallback', () => {
    const result = spawnSync('python3', ['-B', 'scripts/test_runner_policy.py'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });

  it('provisions Python 3.12 before unit tests on either runner path', () => {
    const steps = read('.github/workflows/intent-pr.yml').jobs.test.steps;
    const setup = steps.findIndex((step: { uses?: string }) =>
      step.uses?.startsWith('actions/setup-python@'),
    );
    const tests = steps.findIndex((step: { name?: string }) => step.name === 'Unit tests');
    expect(setup).toBeGreaterThanOrEqual(0);
    expect(setup).toBeLessThan(tests);
    expect(steps[setup].with['python-version']).toBe('3.12');
    expect(steps[setup].if).toBeUndefined();
  });

  it('configures managed caching without Rust cache actions', () => {
    const result = spawnSync('python3', ['-B', 'scripts/test-setup-depot-sccache.py'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
