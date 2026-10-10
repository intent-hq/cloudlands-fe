import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { checkAssertion, checkFixtureLayout } from '../src/assertion-checks.ts';

function findings(code: string) {
  const source = ts.createSourceFile('fixture.test.ts', code, ts.ScriptTarget.Latest, true);
  const result: ReturnType<typeof checkAssertion> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) result.push(...checkAssertion(node, source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

test('detects a poll equality that succeeds when both observed values are absent', () => {
  const code = `expect.poll(async () => { const state = await readState(); return state?.canvas === state?.avatar; }).toBe(true);`;
  const result = findings(code);
  assert.deepEqual(
    result.map((f) => f.rule),
    ['nullish-equality'],
  );
  assert.equal(result[0].file, 'fixture.test.ts');
  assert.equal(result[0].line, 1);
  const poll = (state: { canvas: string; avatar: string } | null) =>
    state?.canvas === state?.avatar;
  assert.equal(poll(null), true);
  assert.equal(poll({ canvas: 'red', avatar: 'blue' }), false);
});

test('does not flag a false-on-missing poll or a guarded comparison', () => {
  for (const body of [
    `if (!state) return false; return state?.canvas === state?.avatar;`,
    `if (state == null) throw Error('missing'); return state?.canvas === state?.avatar;`,
    `return !!state && state?.canvas === state?.avatar;`,
  ])
    assert.deepEqual(
      findings(`expect.poll(() => { const state=readState(); ${body} }).toBe(true);`),
      [],
    );
  assert.deepEqual(findings(`expect(a?.x === a?.y).toBe(false);`), []);
  assert.deepEqual(findings(`expect(a?.x === a?.y).not.toBe(true);`), []);
  assert.equal(
    findings(`expect(!state && state?.x === state?.y).toBe(true);`)[0].rule,
    'nullish-equality',
  );
});

test('flags empty-collection success and respects preceding nonempty assertions', () => {
  assert.equal(
    findings(
      `test('rows', () => { const rows=loadRows(); expect(rows.every(row => row.ok)).toBe(true); });`,
    )[0].rule,
    'empty-every',
  );
  assert.deepEqual(
    findings(
      `test('rows', () => { const rows=loadRows(); expect(rows).toHaveLength(2); expect(rows.every(row => row.ok)).toBe(true); });`,
    ),
    [],
  );
  assert.deepEqual(
    findings(
      `test('rows', () => { const rows=loadRows(); expect(rows.length).toBeGreaterThan(0); expect(rows.every(row => row.ok)).toBe(true); });`,
    ),
    [],
  );
  assert.equal(
    [].every(() => false),
    true,
  );
});

test('identifies assertions against local literals, including nested properties and aliases', () => {
  const result = findings(
    `test('response', () => { const response={success:true,data:{id:'123'}}; const alias=response; expect(response.success).toBe(true); expect(alias.data.id).toBe('123'); });`,
  );
  assert.deepEqual(
    result.map((f) => f.rule),
    ['fixture-only-value', 'fixture-only-value'],
  );
});

test('conditional or stale collection guards cannot hide empty-every findings', () => {
  for (const before of [
    `if (false) expect(rows).toHaveLength(2);`,
    `expect(rows).toHaveLength(2); rows.length=0;`,
  ])
    assert.equal(
      findings(
        `test('rows', () => { const rows=loadRows(); ${before} expect(rows.every(row=>row.ok)).toBe(true); });`,
      )[0].rule,
      'empty-every',
    );
});

test('does not mistake production-preserved values or mutated fixtures for literal-only checks', () => {
  for (const code of [
    `const response=parse({id:'123'}); expect(response.id).toBe('123');`,
    `const response={id:'123'}; update(response); expect(response.id).toBe('456');`,
    `const response={id:'123'}; response.id='456'; expect(response.id).toBe('456');`,
    `const response={n:1}; ++response.n; expect(response.n).toBe(2);`,
    `const response={id:'123'}; { const response=read(); expect(response.id).toBe('123'); }`,
    `const response={id:'123'}; function verify(response) { expect(response.id).toBe('123'); }`,
  ])
    assert.deepEqual(findings(`test('behavior',()=>{${code}});`), []);
  assert.deepEqual(
    findings(
      `const shared={id:'123'}; beforeEach(()=>update(shared)); test('shared',()=>expect(shared.id).toBe('123'));`,
    ),
    [],
  );
});

test('links a measured selector to layout authored by a Svelte test host', () => {
  const source = ts.createSourceFile(
    'spacing.test.ts',
    `test('spacing',()=>{ const el=root.querySelector('[data-testid="queue"]'); expect(el.getBoundingClientRect().top).toBe(24); });`,
    ts.ScriptTarget.Latest,
    true,
  );
  const host = {
    file: 'src/__tests__/Host.svelte',
    code: '<div class="mt-6" data-testid="queue"><RealQueue /></div>',
  };
  const result = checkFixtureLayout(source, [host]);
  assert.equal(result.length, 1);
  assert.equal(result[0].rule, 'fixture-owned-layout');
  assert.equal(result[0].file, host.file);
  assert.deepEqual(checkFixtureLayout(source, [{ ...host, file: 'src/Queue.svelte' }]), []);
  assert.deepEqual(
    checkFixtureLayout(source, [
      { ...host, code: '<RealQueue data-testid="queue" class="mt-6" />' },
    ]),
    [],
  );
  assert.deepEqual(
    checkFixtureLayout(source, [{ ...host, code: '<div data-testid="queue"><RealQueue /></div>' }]),
    [],
  );
  assert.deepEqual(
    checkFixtureLayout(source, [{ ...host, code: '<div class="mt-6" data-testid="unrelated" />' }]),
    [],
  );
});
