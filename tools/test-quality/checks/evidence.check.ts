import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { defaults, Sources, inventory, hash } from '../src/files.ts';
import { Analyzer } from '../src/analyzer.ts';
import { batches } from '../src/runner.ts';
import { decide, reviewKey } from '../src/decisions.ts';
import type { ChoiceAnswer, ReviewState } from '../src/decisions.ts';
import { Store } from '../src/database.ts';
import { report, textReport } from '../src/report.ts';
import {
  caseSplit,
  calibrationMetrics,
  readCalibration,
  validateFrozenSource,
} from '../src/calibration.ts';
import type { CalibrationCase } from '../src/calibration.ts';
import type { ResultRow } from '../src/types.ts';

function fixture(t: TestContext, files: Record<string, string>, config = defaults) {
  const root = mkdtempSync(path.join(tmpdir(), 'evidence-check-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [f, code] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), code);
  }
  const sources = new Sources(root);
  const analyzer = new Analyzer(sources, inventory(root, config), config);
  return {
    root,
    sources,
    analyzer,
    trace: (f = 'subject.test.ts') => analyzer.analyze(f).traces[1],
  };
}

test('selects late event handler, state change and dialog binding ahead of irrelevant imports', (t) => {
  const f = fixture(t, {
    'subject.test.ts': `import Subject from './Subject.svelte'; test('opens image',async()=>{render(Subject);await fireEvent.keyDown(screen.getByRole('button'),{key:'Enter'});expect(screen.getByRole('dialog')).toBeVisible()})`,
    'Subject.svelte': `<script>import Noise from './noise'; import Dialog from './Dialog.svelte'; ${'\n'.repeat(100)} const noise='${'x'.repeat(7000)}'; let open=false; function openImage(){open=true;}</script><button onclick={openImage} onkeydown={(e)=>{if(e.key==='Enter')e.currentTarget.click()}}>Image</button><Dialog bind:open={open}/>`,
    'Dialog.svelte':
      '<script>let {open}=$props();</script>{#if open}<section role="dialog">Image</section>{/if}',
    'noise.ts': `export default '${'n'.repeat(12000)}'`,
  });
  const trace = f.trace();
  const evidence = trace.fragments.map((x) => x.code).join('\n');
  assert.match(evidence, /function openImage\(\)\{open=true/);
  assert.match(evidence, /onkeydown=.*Enter/);
  assert.match(evidence, /Dialog bind:open/);
  assert.ok(!trace.fragments.some((x) => x.file === 'noise.ts'));
  assert.ok(trace.fragments.some((x) => x.file === 'Subject.svelte' && x.line > 100));
  assert.ok(
    trace.fragments.reduce((n, f) => n + f.code.length, trace.targets[0].code.length) <=
      defaults.maxContextChars,
  );
});

test('resolves invoked instance methods and internal method calls beyond a large class prefix', (t) => {
  const f = fixture(t, {
    'subject.test.ts': `import {Harness} from './harness'; describe('self test',()=>{let harness;beforeEach(()=>{harness=new Harness()});test('streams',()=>{harness.sendMessage();expect(harness.events).toContain('token')})})`,
    'harness.ts': `export class Harness { noise='${'x'.repeat(5000)}';events=[];sendMessage(){this.simulateStreaming()}simulateStreaming(){this.events.push('token')}unrelated(){throw new Error('unused')}}`,
  });
  const code = f
    .trace()
    .fragments.map((f) => f.code)
    .join('\n');
  assert.match(code, /sendMessage\(\)\{this.simulateStreaming/);
  assert.match(code, /simulateStreaming\(\)\{this.events.push\('token'\)/);
  assert.doesNotMatch(code, /unused/);
});

test('includes scoped output-transforming helpers and mocks before imported expansions', (t) => {
  const f = fixture(t, {
    'subject.test.ts': `import {produce} from './producer';vi.mock('./boundary',()=>({read:()=>'<fixed>'}));describe('transform',()=>{function fixAnchorAttributes(html){return html.replace('bad','fixed')};test('anchors',()=>{expect(fixAnchorAttributes(produce())).toContain('fixed')})})`,
    'producer.ts': `import {read} from './boundary';export function produce(){return read()}`,
    'boundary.ts': `export function read(){return 'bad'}`,
  });
  const trace = f.trace();
  assert.match(trace.fragments[0].code, /function fixAnchorAttributes/);
  assert.ok(trace.fragments.some((f) => f.code.includes("vi.mock('./boundary'")));
});

const state: ReviewState = {
  evidence: { completeness: 'bounded', omissions: [] },
  evidenceCatalog: {
    'target:a': { file: 'a.test.ts', line: 2, endLine: 3, role: 'target' },
    neighbor: { file: 'a.test.ts', line: 9, endLine: 12, role: 'neighbor' },
  },
  targets: [{ id: 'a', status: 'active' }],
};
const target = { id: 'a', kind: 'test' };
function answers(overrides: Record<string, string> = {}) {
  return Object.fromEntries(
    Object.entries({
      disposition: 'keep',
      basis: 'protected',
      evidence: 'target:a',
      neighbor: 'none',
      completeness: 'sufficient',
      counterexample: 'noneVisible',
      ...overrides,
    }).map(([k, v]) => [
      reviewKey('a', k),
      { type: 'choice', choice: v, confidence: 1, probabilities: { [v]: 1 } },
    ]),
  ) as Record<string, ChoiceAnswer>;
}
test('budget omission produces explicit abstention, even when the judge proposes keep or remove', (t) => {
  const f = fixture(
    t,
    {
      'subject.test.ts': `import {run} from './run';test('run',()=>expect(run()).toBe(2))`,
      'run.ts': `export function run(){const unrelated='${'x'.repeat(7000)}';return 2}`,
    },
    { ...defaults, maxContextChars: 4000, maxFragments: 2 },
  );
  const trace = f.trace();
  assert.equal(trace.evidence?.completeness, 'partial');
  assert.ok(trace.evidence!.omissions.length);
  const batch = batches(trace, 1)[0];
  assert.equal((batch.state.evidence as { completeness: string }).completeness, 'partial');
  for (const disposition of ['keep', 'remove'])
    assert.equal(
      decide(
        { ...state, evidence: trace.evidence! },
        target,
        answers({ disposition, basis: 'tautology' }),
      ).disposition,
      'insufficient-evidence',
    );
});
test('low or weak judgments cannot imply removal and absent neighbors do not establish redundancy', () => {
  assert.equal(
    decide(
      state,
      target,
      answers({ disposition: 'remove', basis: 'weakOracle', counterexample: 'wrongValue' }),
    ).disposition,
    'insufficient-evidence',
  );
  assert.equal(
    decide(state, target, answers({ disposition: 'remove', basis: 'duplicate' })).disposition,
    'insufficient-evidence',
  );
  assert.equal(
    decide(
      state,
      target,
      answers({ disposition: 'consolidate', basis: 'duplicate', neighbor: 'neighbor' }),
    ).disposition,
    'consolidate',
  );
  assert.equal(
    decide(
      state,
      target,
      answers({ disposition: 'remove', basis: 'tautology', counterexample: 'disconnected' }),
    ).disposition,
    'remove',
  );
  const unknown = answers();
  unknown[reviewKey('a', 'evidence')].confidence = 0.2;
  assert.equal(decide(state, target, unknown).disposition, 'insufficient-evidence');
});
test('skipped retirement is distinct from active removal and preserves evidence-linked reasons', () => {
  const decision = decide(
    { ...state, targets: [{ id: 'a', status: 'skipped' }] },
    target,
    answers({ disposition: 'retire-skipped', basis: 'obsoleteSkipped' }),
  );
  assert.equal(decision.disposition, 'retire-skipped');
  assert.deepEqual(decision.evidenceRefs, ['target:a']);
  assert.match(decision.rationale, /does not reduce executed/);
  assert.equal(
    decide(state, target, answers({ disposition: 'retire-skipped', basis: 'obsoleteSkipped' }))
      .disposition,
    'insufficient-evidence',
  );
});

test('migrates old database rows without inventing dispositions, retains decisions and immutable run membership', (t) => {
  const f = fixture(t, { 'subject.test.ts': `test('constant',()=>expect(true).toBe(true))` });
  const db = path.join(f.root, 'isolated.sqlite');
  let store = new Store(db);
  const analysis = f.analyzer.analyze('subject.test.ts');
  const trace = analysis.traces[1];
  const target = trace.targets[0];
  store.saveAnalysis('old', analysis);
  const old = store.start({});
  store.result(old, target, trace.id, null, null, [], null, false);
  store.finish(old, 'complete');
  // Reconstruct the pre-upgrade schema on this disposable database.
  store.db.exec(
    'ALTER TABLE results DROP COLUMN decision; ALTER TABLE results DROP COLUMN evidence; PRAGMA user_version=1',
  );
  store.close();
  store = new Store(db);
  t.after(() => store.close());
  assert.equal(store.results(old)[0].decision, null);
  const before = store.db.prepare('SELECT * FROM results WHERE run_id=?').get(old);
  const next = store.start({});
  const decision = decide(state, { id: 'a', kind: 'test' }, answers());
  store.result(
    next,
    target,
    trace.id,
    null,
    {
      model: 'fixture',
      usage: { input_tokens: 0, output_tokens: 0 },
      answers: {},
      scores: {},
      reviews: { [target.id]: decision },
    },
    [],
    null,
    false,
  );
  store.finish(next, 'complete');
  assert.deepEqual(store.results(next)[0].decision, decision);
  assert.deepEqual(store.db.prepare('SELECT * FROM results WHERE run_id=?').get(old), before);
  assert.throws(
    () => store.result(old, target, trace.id, null, null, [], null, false),
    /finished run/,
  );
  assert.match(
    textReport(report(store.run(old), store.results(old), { threshold: 60, minConfidence: 0.6 })),
    /decision: unavailable/,
  );
  assert.match(
    textReport(report(store.run(next), store.results(next), { threshold: 60, minConfidence: 0.6 })),
    /references: target:a/,
  );
});

test('groups related frozen cases without leakage and gives deterministic splits independent of order', () => {
  const data = readCalibration(
    new URL('../calibration/reviewed-v1.json', import.meta.url).pathname,
  );
  const families = data.cases.map((c) => c.family);
  const groups = new Map<string, string>();
  for (const c of data.cases) {
    const split = caseSplit(c.family, families);
    assert.equal(split, caseSplit(c.family, [...families].reverse()));
    if (groups.has(c.file)) assert.equal(groups.get(c.file), split);
    groups.set(c.file, split);
  }
  assert.equal(new Set(families.map((f) => caseSplit(f, families))).size, 2);
  const related = data.cases.filter((c) =>
    /markdown|anchor-normalization|front-matter/.test(c.file),
  );
  assert.equal(new Set(related.map((c) => c.family)).size, 1);
});

test('rejects rewritten tests instead of comparing old labels against new source', (t) => {
  const f = fixture(t, { 'subject.test.ts': `test('rewritten',()=>expect(real()).toBe(2))` });
  const c = {
    file: 'subject.test.ts',
    testCode: `test('old',()=>expect(true).toBe(true))`,
    sourceHash: hash('old source'),
  } as CalibrationCase;
  assert.throws(() => validateFrozenSource(c, f.sources), /Stale calibration source/);
  c.sourceHash = f.sources.digest(c.file);
  assert.throws(() => validateFrozenSource(c, f.sources), /Stale calibration source/);
});

test('reports independently known agreement, confusion, harmful removals and separate skipped cases', () => {
  const cases = [
    ['a', 'keep', 'active'],
    ['b', 'remove', 'active'],
    ['c', 'strengthen', 'active'],
    ['d', 'retire-skipped', 'skipped'],
    ['e', 'keep', 'active'],
  ].map(([id, expectedDisposition, status]) => ({
    id,
    expectedDisposition,
    status,
    file: 'f',
  })) as CalibrationCase[];
  const rows = [
    ['a', 'remove'],
    ['b', 'remove'],
    ['c', 'insufficient-evidence'],
    ['d', 'retire-skipped'],
  ].map(([id, disposition]) => ({ target: { id }, decision: { disposition } })) as ResultRow[];
  const m = calibrationMetrics(cases, rows);
  assert.equal(m.active.dispositionAgreement, 1 / 3);
  assert.equal(m.active.decidedAgreement, 1 / 2);
  assert.equal(m.active.coverage, 1 / 2);
  assert.equal(m.active.abstentionRate, 1 / 3);
  assert.equal(m.active.incorrectRemoveRecommendations, 1);
  assert.equal(m.active.unavailable, 1);
  assert.equal(m.active.confusion.keep.remove, 1);
  assert.equal(m.active.confusion.keep.unavailable, 1);
  assert.equal(m.skippedOrRetired.agreements, 1);
  const baseline = calibrationMetrics(cases, []);
  assert.equal(baseline.active.dispositionAgreement, null);
  assert.equal(baseline.active.incorrectRemoveRecommendations, null);
});

test('reconstructs pinned source after working-tree rewrites and never sends reference labels to the judge', async (t) => {
  const { execFileSync } = await import('node:child_process');
  const { prepareCalibration } = await import('../src/calibration.ts');
  const { reviewQuestions } = await import('../src/decisions.ts');
  const code = `test('constant',()=>expect(true).toBe(true))`;
  const f = fixture(t, { 'subject.test.ts': code });
  const git = (args: string[], input?: string) =>
    execFileSync('git', args, {
      cwd: f.root,
      input,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'fixture@example.test',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'fixture@example.test',
      },
    }).trim();
  git(['init', '--quiet']);
  const blob = git(['hash-object', '-w', '--stdin'], code);
  const tree = git(['mktree'], `100644 blob ${blob}\tsubject.test.ts\n`);
  const revision = git(['commit-tree', tree], 'Frozen test fixture\n');
  const original = f.trace().targets[0];
  const c: CalibrationCase = {
    id: original.id,
    file: 'subject.test.ts',
    line: 1,
    name: original.name,
    status: 'active',
    family: 'isolated',
    sourceHash: hash(code),
    testCode: code,
    expectedDisposition: 'remove',
    reason: 'SECRET_REFERENCE_REASON',
    evidence: ['SECRET_REFERENCE_EVIDENCE'],
    baseline: { quality: 1, confidence: 1, traceId: 'old', evaluationId: 1 },
  };
  writeFileSync(
    path.join(f.root, 'subject.test.ts'),
    `test('changed',()=>expect(real()).toBe(123))`,
  );
  const data = {
    version: 'fixture',
    sourceRevision: revision,
    labelProvenance: 'SECRET_LABEL_PROVENANCE',
    selection: 'fixture',
    cases: [c],
  };
  const prepared = prepareCalibration(f.root, defaults, data, 'all');
  assert.equal(prepared.traces[0].targets[0].code, code);
  const batch = batches(prepared.traces[0], 1)[0];
  const request = JSON.stringify({
    state: batch.state,
    questions: reviewQuestions(batch.state, batch.targets),
  });
  assert.doesNotMatch(request, /SECRET_|expectedDisposition|baseline|sourceHash/);
  assert.throws(
    () =>
      prepareCalibration(
        f.root,
        defaults,
        { ...data, cases: [{ ...c, sourceHash: hash('rewritten') }] },
        'all',
      ),
    /Stale calibration source/,
  );
});

test('resolves receiver-specific instance methods instead of importing same-named methods from other classes', (t) => {
  const f = fixture(t, {
    'subject.test.ts': `import {A,B} from './classes';test('receivers',()=>{const a=new A();const b=new B();a.sendMessage();b.check();expect(a.output).toBe('sent')})`,
    'classes.ts': `export class A {output='';sendMessage(){this.output='sent'}}export class B {check(){return true}sendMessage(){throw new Error('wrong receiver')}}`,
  });
  const code = f
    .trace()
    .fragments.map((f) => f.code)
    .join('\n');
  assert.match(code, /output='sent'/);
  assert.match(code, /check\(\)/);
  assert.doesNotMatch(code, /wrong receiver/);
});

test('omitting optional neighbor evidence preserves bounded keep/strengthen but cannot establish redundancy', async (t) => {
  const { calibrationEvidence } = await import('../src/calibration.ts');
  const f = fixture(t, { 'subject.test.ts': `test('result',()=>expect(run()).toBe(2))` });
  const original = f.trace();
  const trace = {
    ...original,
    evidence: { completeness: 'bounded' as const, omissions: [] },
    targets: [{ ...original.targets[0], id: 'a' }],
    fragments: [
      {
        file: 'subject.ts',
        line: 1,
        endLine: 1,
        code: 'function handlePaste(){return 2}',
        reason: 'Svelte binding reference to handlePaste',
        required: true,
        priority: 0,
      },
      {
        file: 'other.test.ts',
        line: 1,
        endLine: 1,
        code: 'x'.repeat(23000),
        reason: 'Neighbor test for overlap review',
        required: false,
        priority: 100,
      },
    ],
  };
  const batch = batches(trace, 1)[0];
  const sent = batch.state as unknown as ReviewState;
  assert.equal(sent.evidence.completeness, 'bounded');
  assert.equal(batch.omittedFragments.length, 1);
  assert.equal(batch.omittedFragments[0].required, false);
  assert.equal(
    Object.values(sent.evidenceCatalog).some((r) => r.role === 'neighbor'),
    false,
  );
  assert.equal(decide(sent, target, answers()).disposition, 'keep');
  assert.equal(
    decide(
      sent,
      target,
      answers({ disposition: 'strengthen', basis: 'weakOracle', counterexample: 'wrongValue' }),
    ).disposition,
    'strengthen',
  );
  assert.equal(
    decide(sent, target, answers({ disposition: 'remove', basis: 'duplicate' })).disposition,
    'insufficient-evidence',
  );
  const report = calibrationEvidence([trace]);
  assert.equal(report.evidenceSummary.bounded, 1);
  assert.equal(report.evidenceSummary.optionalFragmentsOmitted, 1);
  assert.equal(report.evidenceSummary.requiredFragmentsOmitted, 0);
  assert.deepEqual(report.evidence[0].handlerAndHelperEvidence, [
    { file: 'subject.ts', line: 1, endLine: 1, reason: 'Svelte binding reference to handlePaste' },
  ]);
});

test('omitting an essential handler makes request-level calibration partial even when the trace is bounded', async (t) => {
  const { calibrationEvidence } = await import('../src/calibration.ts');
  const f = fixture(t, { 'subject.test.ts': `test('result',()=>expect(run()).toBe(2))` });
  const original = f.trace();
  const trace = {
    ...original,
    evidence: { completeness: 'bounded' as const, omissions: [] },
    targets: [{ ...original.targets[0], id: 'a' }],
    fragments: [
      {
        file: 'subject.ts',
        line: 1000,
        endLine: 1600,
        code: 'x'.repeat(23000),
        reason: 'Svelte binding reference to handlePaste',
        required: true,
      },
    ],
  };
  const batch = batches(trace, 1)[0];
  const sent = batch.state as unknown as ReviewState;
  assert.equal(sent.evidence.completeness, 'partial');
  assert.equal(decide(sent, target, answers()).disposition, 'insufficient-evidence');
  const report = calibrationEvidence([trace]);
  assert.equal(report.evidenceSummary.bounded, 0);
  assert.equal(report.evidenceSummary.partial, 1);
  assert.equal(report.evidenceSummary.traceBounded, 1);
  assert.equal(report.evidenceSummary.requiredFragmentsOmitted, 1);
  assert.equal(report.evidence[0].handlerAndHelperEvidence.length, 0);
});

test('evaluation cache excludes legacy decisions without a decision-policy version and reuses the current version', async (t) => {
  const { evaluate } = await import('../src/runner.ts');
  const { buildQuestions, RUBRIC, RUBRIC_VERSION } = await import('../src/rubric.ts');
  const { reviewQuestions, DECISION_VERSION } = await import('../src/decisions.ts');
  const f = fixture(t, { 'subject.test.ts': `test('constant',()=>expect(true).toBe(true))` });
  const original = f.trace();
  const trace = { ...original, targets: [original.targets[0]] };
  const store = new Store(':memory:');
  t.after(() => store.close());
  store.saveAnalysis('cache-fixture', {
    traces: [trace],
    dependencies: trace.dependencies,
    warnings: [],
  });
  const batch = batches(trace, 1)[0];
  const rubricHash = hash([RUBRIC_VERSION, RUBRIC]);
  const oldKey = hash([
    trace.id,
    batch.state,
    { ...buildQuestions(batch.targets), ...reviewQuestions(batch.state, batch.targets) },
    rubricHash,
    'jev-1.13.0',
  ]);
  const judgment = {
    model: 'jev-1.13.0',
    usage: { input_tokens: 0, output_tokens: 0 },
    answers: {},
    scores: {},
  };
  store.saveEvaluation(oldKey, trace.id, 'jev-1.13.0', rubricHash, {}, judgment, 0);
  let calls = 0;
  const options = {
    apiKey: 'offline-fixture',
    concurrency: 1,
    batchSize: 1,
    judge: async () => {
      calls++;
      return judgment;
    },
  };
  const first = await evaluate(store, [trace], options, {});
  assert.equal(calls, 1);
  assert.equal(first.cacheHits, 0);
  assert.equal(JSON.parse(store.run(first.runId).options).decisionVersion, DECISION_VERSION);
  const second = await evaluate(store, [trace], options, {});
  assert.equal(calls, 1);
  assert.equal(second.cacheHits, 1);
});
