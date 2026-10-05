// @verify-changed-triggers: src/test-setup.ts, vitest.config.ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Regression guard for the per-worker scrub in src/test-setup.ts: the `scripts/`
// CLI suites assert exact child stderr, and on a Datadog-instrumented host the
// inherited `NODE_OPTIONS=--require dd-trace/init` wrote tracer startup logs to
// every child (cloudlands-fe#2547 verifier run, 17 failures). A child spawned
// with the worker's default env must see no NODE_OPTIONS and no DD_* variables;
// on an injected host this fails if a config refactor drops the scrub.
//
// Two DD_* keys are expected: the launcher opt-out test-setup sets on purpose,
// and DD_ROOT_JS_SESSION_ID, which a tracer loaded in the worker itself adds to
// every child env at spawn() time (dd-trace telemetry/session-propagation) —
// after any env scrub can run, and without any stderr output.
const EXPECTED_DD_KEYS = ['DD_INSTRUMENT_SERVICE_WITH_APM', 'DD_ROOT_JS_SESSION_ID'];
const PRINT_INJECTION = [
  "process.stdout.write(process.env.NODE_OPTIONS ?? '');",
  `const expected = new Set(${JSON.stringify(EXPECTED_DD_KEYS)});`,
  'process.stdout.write(',
  "  Object.keys(process.env).filter((k) => k.startsWith('DD_') && !expected.has(k)).join(','),",
  ');',
].join('\n');

describe('child processes spawned by unit tests', () => {
  it('inherit neither NODE_OPTIONS nor DD_* from the host', () => {
    const result = spawnSync(process.execPath, ['-e', PRINT_INJECTION], { encoding: 'utf8' });
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0,
      stdout: '',
      stderr: '',
    });
  });
});
