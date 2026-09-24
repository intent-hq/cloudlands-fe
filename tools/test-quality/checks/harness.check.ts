import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defaults, inventory, selectedFiles } from '../src/files.ts';
import { Store } from '../src/database.ts';
import { batches, evaluate, scan } from '../src/runner.ts';
import { report, textReport } from '../src/report.ts';
import type { Judgment } from '../src/types.ts';
import { JevHttpError } from '../src/jev.ts';

function fixture(t: TestContext) {
  const root = mkdtempSync(path.join(tmpdir(), 'test-quality-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (file: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  put('src/policy.ts', `export function allow(role: string) { return role === 'admin'; }`);
  put('src/index.ts', `export { allow as permitted } from './policy.js';`);
  put(
    'suite.test.ts',
    `
import { describe, it as check, expect as verify, beforeEach } from 'vitest';
import { permitted } from '@src/index';
let role = 'guest';
function assertDenied(value: boolean) { verify(value).toBe(false); }
describe('permissions', () => {
  beforeEach(() => { role = 'guest'; });
  check('denies guests', () => { assertDenied(permitted(role)); verify(permitted('admin')).toBe(true); });
  check.each(['owner', 'guest'])('denies %s', (value) => { verify(permitted(value)).toBe(false); });
  check.todo('supports tenant roles');
});
describe.skip('retired', () => { check('old case', () => verify(permitted('admin')).toBe(true)); });
`,
  );
  const store = new Store(':memory:');
  t.after(() => store.close());
  const config = { ...defaults, aliases: { '@src': 'src' } };
  return { root, put, store, config };
}

const judgeFixture = async (
  _state: unknown,
  targets: { id: string; kind: string }[],
): Promise<Judgment> => ({
  model: 'jev-fixture',
  usage: { input_tokens: 42, output_tokens: 20 },
  answers: {},
  scores: Object.fromEntries(
    targets.map((target) => [
      target.id,
      {
        overall: target.kind === 'assertion' ? 25 : 80,
        confidence: 0.9,
        dimensions: {
          relevance: {
            score: target.kind === 'assertion' ? 25 : 80,
            confidence: 0.9,
            probabilities: { '0': 0, '1': 1, '2': 0, '3': 0, '4': 0 },
          },
        },
      },
    ]),
  ),
});

test('discovers declaration sites, aliased assertions, helpers, setup and source through barrel exports', (t) => {
  const { root, store, config } = fixture(t);
  const result = scan(root, config, [], store);
  const targets = result.traces.flatMap((trace) => trace.targets);
  assert.equal(targets.filter((target) => target.kind === 'test').length, 4);
  assert.equal(targets.filter((target) => target.kind === 'assertion').length, 4);
  const guest = result.traces.find(
    (trace) => trace.targets[0].name === 'permissions > denies guests',
  )!;
  assert.equal(guest.targets.filter((target) => target.kind === 'assertion').length, 2);
  assert.ok(
    guest.fragments.some(
      (fragment) => fragment.file === 'src/policy.ts' && fragment.reason === 'Reference to allow',
    ),
  );
  assert.ok(guest.fragments.some((fragment) => fragment.reason === 'Test setup or teardown'));
  assert.equal(targets.find((target) => target.name === 'retired > old case')?.status, 'skipped');
  assert.equal(
    targets.find((target) => target.name === 'permissions > supports tenant roles')?.status,
    'todo',
  );
  assert.ok(
    result.traces
      .find((trace) => trace.targets[0].name.endsWith('denies %s'))
      ?.warnings.some((warning) => warning.includes('Parameterized')),
  );
});

test('never treats strings, comments or asymmetric matchers as assertion sites', (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'nested.spec.ts',
    `import { test, expect } from 'vitest';
const s = "test('fake', () => expect(false).toBe(true))";
// expect('ignored').toBe('ignored');
test('nested matcher', () => { expect({id: 'a'}).toEqual({id: expect.any(String)}); expect.assertions(1); });`,
  );
  const result = scan(root, config, ['nested.spec.ts'], store);
  assert.equal(result.traces.length, 2);
  assert.equal(result.traces[1].targets.length, 2);
});

test('recognizes namespace APIs and named callbacks without executing test code', (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'namespace.test.ts',
    `import * as v from 'vitest'; import * as a from 'node:assert/strict';
function body() { v.expect(2 + 2).toBe(4); a.equal(2 + 3, 5); }
v.describe('math', () => { v.test('named function', body); v.test('external callback', unknownCallback); });`,
  );
  const { traces } = scan(root, config, ['namespace.test.ts'], store);
  assert.equal(traces.length, 3);
  assert.equal(traces[1].targets.filter((target) => target.kind === 'assertion').length, 2);
  assert.ok(traces[2].warnings.some((warning) => warning.includes('No recognized assertion')));
});

test('handles native assert aliases and reports unrecognized generated suites', (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'native.test.ts',
    `import { ok as ensure } from 'node:assert'; test('native', () => ensure(true));`,
  );
  put('generated.test.ts', `registerContractCases();`);
  const result = scan(root, config, ['native.test.ts', 'generated.test.ts'], store);
  assert.equal(
    result.traces.flatMap((trace) => trace.targets).filter((target) => target.kind === 'assertion')
      .length,
    1,
  );
  assert.ok(
    result.traces
      .find((trace) => trace.file === 'generated.test.ts')!
      .warnings.some((warning) => warning.includes('No recognized test')),
  );
});

test('does not count production assertions as test oracles and bounds Svelte context', (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'src/checked.ts',
    `import assert from 'node:assert/strict'; export function checked(value: number) { assert(value > 0); return value * 2; }`,
  );
  put(
    'src/Widget.svelte',
    `<script lang="ts">let { count = 0 } = $props();</script><span>{count}</span>`,
  );
  put(
    'component.spec.ts',
    `import { checked } from './src/checked'; import Widget from './src/Widget.svelte'; test('behavior', () => { render(Widget); expect(checked(2)).toBe(4); });`,
  );
  const { traces } = scan(root, config, ['component.spec.ts'], store);
  assert.equal(traces[1].targets.filter((target) => target.kind === 'assertion').length, 1);
  assert.ok(traces[1].fragments.some((fragment) => fragment.file === 'src/checked.ts'));
  assert.ok(traces[1].fragments.some((fragment) => fragment.file === 'src/Widget.svelte'));
  assert.ok(traces[1].warnings.some((warning) => warning.includes('template references')));
});

test('caches analysis and invalidates it when a referenced source changes', (t) => {
  const { root, put, store, config } = fixture(t);
  const first = scan(root, config, [], store);
  assert.equal(first.cachedFiles, 0);
  const second = scan(root, config, [], store);
  assert.equal(second.cachedFiles, 1);
  assert.equal(second.traces[1].id, first.traces[1].id);
  put('src/policy.ts', `export function allow(role: string) { return role === 'owner'; }`);
  const third = scan(root, config, [], store);
  assert.equal(third.cachedFiles, 0);
  assert.notEqual(third.traces[1].id, first.traces[1].id);
  assert.equal(third.traces[1].targets[0].id, first.traces[1].targets[0].id);
  assert.equal(store.trace(first.traces[1].id).id, first.traces[1].id);
});

test('filters paths and names, excludes the harness, and rejects empty selections', (t) => {
  const { root, put, store, config } = fixture(t);
  put('tools/test-quality/ignored.test.ts', `test('ignored', () => {});`);
  put('sub/other.spec.ts', `test('other', () => {});`);
  const files = inventory(root, config);
  assert.deepEqual(selectedFiles(files, ['sub'], config), ['sub/other.spec.ts']);
  assert.throws(() => selectedFiles(files, ['missing'], config), /No test files match/);
  const result = scan(root, config, ['suite.test.ts'], store, 'denies guests');
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0].targets[0].kind, 'test');
  assert.throws(() => scan(root, config, [], store, 'missing test'), /No test declarations/);
  assert.equal(
    files.some((file) => file.includes('tools/test-quality')),
    false,
  );
});

test('persists complete runs and reuses judgments without spending or an API key', async (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store);
  let calls = 0;
  const countingJudge = async (state: unknown, targets: { id: string; kind: string }[]) => {
    calls++;
    return judgeFixture(state, targets);
  };
  const options = {
    apiKey: 'local-fixture',
    concurrency: 2,
    batchSize: 8,
    judge: countingJudge,
  };
  const first = await evaluate(store, traces, options, {});
  assert.equal(calls, traces.length);
  assert.equal(first.errors, 0);
  const second = await evaluate(
    store,
    traces,
    { ...options, apiKey: undefined, maxRequests: 0 },
    {},
  );
  assert.equal(second.requests, 0);
  assert.equal(calls, traces.length);
  assert.notEqual(first.runId, second.runId);
  const rows = store.results(first.runId);
  assert.equal(rows.length, 9);
  assert.equal(
    store.results(second.runId).every((row) => row.cached),
    true,
  );
  assert.equal(store.history(rows[0].target.id).length, 2);
  const value = report(store.run(first.runId), rows, {
    threshold: 60,
    minConfidence: 0.6,
    failingOnly: true,
    kind: 'assertion',
  });
  assert.equal(value.summary.lowScores, 4);
  assert.equal(value.results.length, 4);
  assert.ok(value.results.every((row) => row.status === 'low-score'));
  await assert.rejects(
    evaluate(store, traces, { ...options, fresh: true, maxRequests: 0 }, {}),
    /exceeding/,
  );
  const third = await evaluate(store, traces, { ...options, provider: 'vercel' }, {});
  assert.equal(third.requests, traces.length);
});

test('records API failures as partial results and retries failed jobs on later runs', async (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store, 'denies guests');
  const fail = async (): Promise<Judgment> => {
    throw new Error('Do not expose local-secret');
  };
  const result = await evaluate(
    store,
    traces,
    { apiKey: 'local-secret', concurrency: 1, batchSize: 8, judge: fail },
    {},
  );
  assert.equal(store.run(result.runId).status, 'partial');
  const rows = store.results(result.runId);
  assert.equal(
    rows.every((row) => row.score === null),
    true,
  );
  assert.equal(
    rows.every((row) => !row.error!.includes('local-secret')),
    true,
  );
  const retry = await evaluate(
    store,
    traces,
    {
      apiKey: 'local-secret',
      concurrency: 1,
      batchSize: 8,
      judge: judgeFixture,
    },
    {},
  );
  assert.equal(retry.requests, 1);
  assert.equal(store.run(retry.runId).status, 'complete');
});

for (const status of [401, 402, 403]) {
  test(`stops uncached requests after HTTP ${status} and preserves cached results`, async (t) => {
    const { root, store, config } = fixture(t);
    const { traces } = scan(root, config, [], store);
    await evaluate(
      store,
      [traces.at(-1)!],
      {
        apiKey: 'fixture',
        provider: 'vercel',
        concurrency: 1,
        batchSize: 8,
        judge: judgeFixture,
      },
      {},
    );
    let calls = 0;
    const result = await evaluate(
      store,
      traces,
      {
        apiKey: 'gateway-secret',
        provider: 'vercel',
        concurrency: 1,
        batchSize: 8,
        judge: async (_state, _targets, options) => {
          calls++;
          assert.equal(options.provider, 'vercel');
          throw new JevHttpError(status);
        },
      },
      {},
    );
    assert.equal(calls, 1);
    assert.equal(result.requests, 1);
    assert.equal(result.cacheHits, 1);
    assert.equal(result.skippedRequests, traces.length - 2);
    assert.equal(
      store.results(result.runId).length,
      traces.reduce((n, trace) => n + trace.targets.length, 0),
    );
    assert.equal(store.run(result.runId).status, 'partial');
    assert.ok(store.results(result.runId).some((row) => row.cached && row.score));
    assert.ok(store.results(result.runId).some((row) => row.error?.startsWith('Not attempted')));
    const resumed = await evaluate(
      store,
      traces,
      {
        apiKey: 'gateway-secret',
        provider: 'vercel',
        concurrency: 1,
        batchSize: 8,
        judge: judgeFixture,
      },
      {},
    );
    assert.equal(resumed.requests, traces.length - 1);
    assert.equal(store.run(resumed.runId).status, 'complete');
    const saved = store.evaluation(
      store.results(resumed.runId).find((row) => !row.cached)!.evaluationId!,
    ) as { request: { provider: string; endpoint: string } };
    assert.equal(saved.request.provider, 'vercel');
    assert.equal(saved.request.endpoint, 'https://ai-gateway.vercel.sh/typesafe/v1/systemone');
  });
}

test('opens the circuit after repeated service failures and leaves remaining targets resumable', async (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store);
  let calls = 0;
  const result = await evaluate(
    store,
    traces,
    {
      apiKey: 'fixture',
      concurrency: 1,
      batchSize: 8,
      maxConsecutiveFailures: 2,
      judge: async () => {
        calls++;
        throw new JevHttpError(503);
      },
    },
    {},
  );
  assert.equal(calls, 2);
  assert.equal(result.skippedRequests, traces.length - 2);
  assert.equal(store.run(result.runId).status, 'partial');
  assert.ok(store.results(result.runId).some((row) => row.error?.includes('consecutive failed')));
});

for (const status of [429, 503]) {
  test(`strict stop sends no more HTTP calls after the first ${status}`, async (t) => {
    const { root, store, config } = fixture(t);
    const { traces } = scan(root, config, [], store);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      return new Response('{}', { status });
    });
    const result = await evaluate(
      store,
      traces,
      {
        apiKey: 'fixture',
        concurrency: 1,
        batchSize: 8,
        retries: 0,
        maxConsecutiveFailures: 1,
      },
      {},
    );
    assert.equal(calls, 1);
    assert.equal(result.requests, 1);
    assert.equal(result.skippedRequests, traces.length - 1);
    assert.equal(store.run(result.runId).status, 'partial');
    assert.equal(store.results(result.runId).filter((row) => row.score !== null).length, 0);
  });
}

test('bounds concurrency while preserving every result', async (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store);
  let active = 0;
  let peak = 0;
  const deferredJudge = async (state: unknown, targets: { id: string; kind: string }[]) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active--;
    return judgeFixture(state, targets);
  };
  const result = await evaluate(
    store,
    traces,
    { apiKey: 'fixture', concurrency: 2, batchSize: 1, judge: deferredJudge },
    {},
  );
  assert.equal(peak, 2);
  assert.equal(store.results(result.runId).length, 9);
});

test('context budget is explicit and saved trace survives a database reopen', (t) => {
  const { root, put, config } = fixture(t);
  put(
    'large.test.ts',
    `test('large', () => { const data = '${'x'.repeat(40000)}'; expect(data).toBeTruthy(); });`,
  );
  const dbPath = path.join(root, 'audit.sqlite');
  const store = new Store(dbPath);
  const { traces } = scan(root, config, ['large.test.ts'], store);
  const trace = traces[1];
  assert.ok(trace.warnings.some((warning) => warning.includes('truncated')));
  for (const batch of batches(trace, 8))
    assert.ok(Buffer.byteLength(JSON.stringify(batch.state)) <= 24000);
  store.close();
  const reopened = new Store(dbPath);
  assert.deepEqual(reopened.trace(trace.id), trace);
  reopened.close();
});

test('a failed trace write cannot leave a reusable incomplete analysis cache', (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store);
  const isolated = new Store(':memory:');
  t.after(() => isolated.close());
  isolated.db.exec(
    `CREATE TRIGGER reject_second BEFORE INSERT ON traces WHEN NEW.id = '${traces[1].id}' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;`,
  );
  assert.throws(
    () =>
      isolated.saveAnalysis('atomic', {
        traces,
        dependencies: {},
        warnings: [],
      }),
    /fixture write failure/,
  );
  assert.equal(isolated.cachedAnalysis('atomic'), undefined);
  assert.throws(() => isolated.trace(traces[0].id), /Trace not found/);
});

test('CLI emits parseable JSON and rejects invalid options before API work', (t) => {
  const { root } = fixture(t);
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const run = (args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const scanned = run(['scan', '--root', root, '--format', 'json']);
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(JSON.parse(scanned.stdout).files, 1);
  const invalid = run(['scan', '--root', root, '--concurrency', '0']);
  assert.equal(invalid.status, 1);
  const missing = run(['report', '--root', root, '--db', 'missing.sqlite']);
  assert.equal(missing.status, 1);
});

test('retains setup and tested production statements ahead of a large unrelated registry', (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'src/registry.ts',
    `export const registry = { ${Array.from({ length: 300 }, (_, i) => `unused${i}: '${'x'.repeat(30)}'`).join(',')}, execute: 'exec' };`,
  );
  put(
    'src/install.ts',
    `import { registry } from './registry'; export function install(register) { ${Array.from({ length: 100 }, (_, i) => `register(registry.unused${i}, () => '${'y'.repeat(30)}');`).join('\n')} register(registry.execute, (input) => input.allowed ? 'ok' : 'denied'); }`,
  );
  put(
    'context.test.ts',
    `import { registry } from './src/registry'; import { install } from './src/install'; let handlers = new Map(); beforeEach(() => install((name, fn) => handlers.set(name, fn))); test('denies execution', () => expect(handlers.get(registry.execute)({allowed:false})).toBe('denied'));`,
  );
  const { traces } = scan(root, { ...config, maxContextChars: 5000 }, ['context.test.ts'], store);
  const batch = batches(traces[1], 8)[0];
  const evidence = batch.state.fragments as { file: string; code: string }[];
  assert.ok(evidence.some((f) => f.file === 'src/install.ts' && f.code.includes("'denied'")));
  assert.ok(evidence.some((f) => f.file === 'context.test.ts' && f.code.includes('beforeEach')));
  assert.ok(evidence.some((f) => f.file === 'src/registry.ts' && f.code.includes("'exec'")));
  assert.ok(Buffer.byteLength(JSON.stringify(batch.state)) <= 24000);
});

test('includes the Svelte template and its child after a long script and invalidates child edits', (t) => {
  const { root, put, store, config } = fixture(t);
  put('src/Child.svelte', '<button>Save</button>');
  put(
    'src/Parent.svelte',
    `<script>import Child from './Child.svelte'; const filler = '${'x'.repeat(7000)}';</script><Child />`,
  );
  put(
    'svelte.test.ts',
    `import Parent from './src/Parent.svelte'; test('save', () => { render(Parent); expect(screen.getByRole('button')).toBeTruthy(); });`,
  );
  const first = scan(root, config, ['svelte.test.ts'], store);
  const fragments = first.traces[1].fragments;
  assert.ok(fragments.some((f) => f.file === 'src/Parent.svelte' && f.code.includes('<Child />')));
  assert.ok(
    fragments.some(
      (f) => f.file === 'src/Child.svelte' && f.code.includes('<button>Save</button>'),
    ),
  );
  put('src/Child.svelte', '<button>Delete</button>');
  const second = scan(root, config, ['svelte.test.ts'], store);
  assert.equal(second.cachedFiles, 0);
  assert.notEqual(second.traces[1].id, first.traces[1].id);
});

test('captures literal CSS file evidence and invalidates it without treating packages as local aliases', (t) => {
  const { root, put, store, config } = fixture(t);
  put('src/theme.css', ':root { --ink: black; }');
  put(
    'css.test.ts',
    `import { render } from '@testing-library/svelte'; import {readFileSync} from 'node:fs'; test('ink', () => { render(); expect(readFileSync('src/theme.css','utf8')).toContain('--ink'); });`,
  );
  const aliasedConfig = { ...config, aliases: { '@': 'src' } };
  const first = scan(root, aliasedConfig, ['css.test.ts'], store);
  assert.ok(first.traces[1].fragments.some((f) => f.file === 'src/theme.css'));
  assert.ok(!first.traces[1].warnings.some((w) => w.includes('@testing-library')));
  assert.equal(scan(root, aliasedConfig, ['css.test.ts'], store).cachedFiles, 1);
  put('src/theme.css', ':root { --ink: white; }');
  assert.equal(scan(root, aliasedConfig, ['css.test.ts'], store).cachedFiles, 0);
});

test('quality threshold is independent of criticality and legacy reports keep their original meaning', async (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store, 'denies guests');
  const result = await evaluate(
    store,
    traces,
    { apiKey: 'fixture', concurrency: 1, batchSize: 8, judge: judgeFixture },
    {},
  );
  const rows = store.results(result.runId);
  const options = { threshold: 60, minConfidence: 0.6 };
  const legacy = report(store.run(result.runId), rows, options);
  assert.equal(legacy.scoreMetric, 'legacy-combined');
  assert.match(textReport(legacy), /legacy-combined/);
  const updated = rows.map((row, i) => ({
    ...row,
    score: {
      ...row.score!,
      overall: i === 0 ? 90 : 30,
      quality: i === 0 ? 90 : 30,
      criticality: i === 0 ? 0 : 100,
      criticalityConfidence: 0.1,
    },
  }));
  const current = report(store.run(result.runId), updated, options);
  assert.equal(current.scoreMetric, 'quality');
  assert.equal(current.results.find((r) => r.score!.criticality === 0)!.lowScore, false);
  assert.ok(current.results.filter((r) => r.score!.criticality === 100).every((r) => r.lowScore));
  assert.match(textReport(current), /quality=90.0 criticality=0.0/);
  assert.equal(store.results(result.runId)[0].score!.quality, undefined);
});

test('many context warnings cannot crowd production evidence out of a request', (t) => {
  const { root, store, config } = fixture(t);
  const { traces } = scan(root, config, [], store, 'denies guests');
  const trace = {
    ...traces[0],
    warnings: Array.from(
      { length: 180 },
      (_, index) => `Unresolved evidence ${index}: ${'x'.repeat(120)}`,
    ),
  };
  const [batch] = batches(trace, 8);
  const state = batch.state as {
    warnings: string[];
    fragments: { file: string }[];
  };
  assert.equal(batch.warnings.length, 180);
  assert.ok(state.warnings.length < 12);
  assert.ok(state.fragments.some((f) => f.file === 'src/policy.ts'));
  assert.ok(Buffer.byteLength(JSON.stringify(state)) <= 24000);
});

test('audit persists findings offline and report surfaces them independently of model scores', async (t) => {
  const { root, put, store, config } = fixture(t);
  put(
    'weak.test.ts',
    `test('literal',()=>{ const response={ok:true}; expect(response.ok).toBe(true); });`,
  );
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const audited = spawnSync(
    process.execPath,
    [
      cli,
      'audit',
      'weak.test.ts',
      '--root',
      root,
      '--env',
      '.',
      '--format',
      'json',
      '--fail-on-findings',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(audited.status, 2, audited.stderr);
  const output = JSON.parse(audited.stdout);
  assert.equal(output.metrics.requests, 0);
  assert.equal(output.summary.errors, 0);
  assert.equal(output.summary.findings, 1);
  assert.equal(output.scoreMetric, 'static-checks');
  const saved = spawnSync(
    process.execPath,
    [
      cli,
      'report',
      '--root',
      root,
      '--run',
      output.run.id,
      '--kind',
      'test',
      '--failing-only',
      '--format',
      'json',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(saved.status, 0, saved.stderr);
  assert.equal(JSON.parse(saved.stdout).results[0].target.findings[0].rule, 'fixture-only-value');
  const { traces } = scan(root, config, ['weak.test.ts'], store);
  const run = await evaluate(
    store,
    traces,
    { apiKey: 'fixture', batchSize: 8, concurrency: 1, judge: judgeFixture },
    {},
  );
  const value = report(store.run(run.runId), store.results(run.runId), {
    threshold: 60,
    minConfidence: 0.6,
    failingOnly: true,
    kind: 'test',
  });
  assert.equal(value.results.length, 1);
  assert.equal(value.results[0].score!.overall, 80);
  assert.equal(value.results[0].status, 'finding');
  assert.equal(value.results[0].lowScore, false);
  assert.match(textReport(value), /fixture-only-value/);
});
