// @verify-changed-triggers: scripts/intentd-skew-evidence.mjs

import { describe, expect, it } from 'vitest';
import {
  EVENT_GOLDEN,
  METHOD_GOLDEN,
  declaredIntentdPrs,
  intentdDependencyEvidence,
} from './intentd-skew-evidence.mjs';

const FE = 'intent-hq/cloudlands-fe';
const BE = 'intent-hq/intentd';
const PIN = '0.11.160';
const BASE = 'a'.repeat(40);
const FE_TAG = 'v2.303.2';
// v0.11.160's tag commit; fe commits merged after it are "fresh".
const CUTOFF = Date.parse('2026-11-09T03:24:40Z') / 1000;

const b64 = (text: string) => Buffer.from(text).toString('base64');
const methods = (...names: string[]) =>
  `# Golden list\n${names.map((name) => `method ${name}`).join('\n')}\n`;
const events = (...types: string[]) => JSON.stringify({ version: 1, types });

let shas = 0;
function commit(subject: string, date = '2026-11-09T06:00:00Z', body = '') {
  shas += 1;
  return {
    sha: shas.toString(16).padStart(40, '0'),
    commit: { committer: { date }, message: body ? `${subject}\n\n${body}` : subject },
  };
}

/** The 2026-11-09 stall: 11 fresh fe commits, intentd ahead, none depends on it. */
function harness() {
  const responses = new Map<string, unknown>();
  const commits = [
    commit('fix: older change (#4300)', '2026-11-09T02:00:00Z'),
    commit('feat(providers): show CLI versions for every provider (#4326)'),
    commit('fix(onboarding): land returning backends on Home (#4332)'),
    commit('fix: bump intentd sidecar to v0.11.160 (#4329)'),
    commit('chore(release): 2.303.3 (#4330)'),
  ];
  const fePrs: Record<number, string> = {
    4300: 'Companion: intent-hq/intentd#3100',
    4326: 'Guide updated in companion intentd PR: intent-hq/intentd#3176',
    4332: 'No backend change.',
  };
  const bePrs: Record<number, { merged_at: string | null; merge_commit_sha: string | null }> = {
    3100: { merged_at: '2026-11-08T01:00:00Z', merge_commit_sha: 'c'.repeat(40) },
    3176: { merged_at: '2026-11-09T05:00:00Z', merge_commit_sha: 'd'.repeat(40) },
  };
  const beFiles: Record<number, { filename: string }[]> = {
    3100: [{ filename: 'crates/intent-transport/src/catalog.rs' }],
    3176: [{ filename: 'crates/intent-services/resources/assistant-app-guide.md' }],
  };
  const contained: Record<string, string> = {
    ['d'.repeat(40)]: 'ahead',
    ['c'.repeat(40)]: 'behind',
  };
  const catalog = {
    [BASE]: { methods: methods('agent.list'), events: events('agent:completed') },
    main: { methods: methods('agent.list'), events: events('agent:completed') },
  };
  // Files of the fresh #4326 commit; other commits change nothing.
  const files: { filename: string; changes: number; patch?: string }[] = [
    { filename: 'src/lib/providers.ts', changes: 2, patch: "@@ -1 +1 @@\n+call('agent.list')" },
  ];
  const calls: string[] = [];
  const queries: string[] = [];
  let graphqlError: Error | null = null;
  const graphql = (query: string) => {
    queries.push(query);
    if (graphqlError) throw graphqlError;
    const repository: Record<string, unknown> = {};
    for (const [, n] of query.matchAll(/p(\d+): pullRequest\(number: \1\)/g))
      if (Number(n) in fePrs) repository[`p${n}`] = { number: Number(n), body: fePrs[Number(n)] };
    return { data: { repository } };
  };
  const api = (endpoint: string) => {
    calls.push(endpoint);
    if (responses.has(endpoint)) {
      const value = responses.get(endpoint);
      if (value instanceof Error) throw value;
      return value;
    }
    let match = endpoint.match(
      /^repos\/intent-hq\/cloudlands-fe\/compare\/v2\.303\.2\.\.\.main\?per_page=100&page=(\d+)$/,
    );
    if (match) return { commits: match[1] === '1' ? commits : [] };
    match = endpoint.match(/^repos\/intent-hq\/cloudlands-fe\/commits\/([0-9a-f]{40})$/);
    const owner = match && commits.find((c) => c.sha === match![1]);
    if (owner) return { files: owner.commit.message.includes('(#4326)') ? files : [] };
    match = endpoint.match(/^repos\/intent-hq\/intentd\/pulls\/(\d+)$/);
    if (match && Number(match[1]) in bePrs) return bePrs[Number(match[1])];
    match = endpoint.match(
      /^repos\/intent-hq\/intentd\/pulls\/(\d+)\/files\?per_page=100&page=(\d+)$/,
    );
    if (match && Number(match[1]) in beFiles)
      return match[2] === '1' ? beFiles[Number(match[1])] : [];
    match = endpoint.match(/^repos\/intent-hq\/intentd\/compare\/a{40}\.\.\.([0-9a-f]{40})$/);
    if (match && match[1] in contained) return { status: contained[match[1]] };
    match = endpoint.match(/^repos\/intent-hq\/intentd\/contents\/(.+)\?ref=(.+)$/);
    if (match && match[2] in catalog) {
      const ref = catalog[match[2] as keyof typeof catalog];
      if (match[1] === METHOD_GOLDEN) return { content: b64(ref.methods) };
      if (match[1] === EVENT_GOLDEN) return { content: b64(ref.events) };
    }
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  const logs: string[] = [];
  return {
    responses,
    commits,
    fePrs,
    bePrs,
    beFiles,
    contained,
    catalog,
    files,
    calls,
    queries,
    logs,
    failGraphql: (error: Error) => (graphqlError = error),
    check: (overrides = {}) =>
      intentdDependencyEvidence(
        {
          pin: PIN,
          baselineSha: BASE,
          feTag: FE_TAG,
          cutoffEpoch: CUTOFF,
          feRepo: FE,
          ...overrides,
        },
        { api, graphql, log: (line: string) => logs.push(line) },
      ),
  };
}

describe('declared intentd PR references', () => {
  it.each([
    ['intent-hq/intentd#3184', [3184]],
    ['see intentd#12 and https://github.com/intent-hq/intentd/pull/34.', [12, 34]],
    ['companion intentd PR #56', [56]],
    ['intentd PR: #57, intentd pull request #58, intent-hq/intentd/pulls/59', [57, 58, 59]],
    ['intentd #7, intentd#7', [7]],
    ['intent-hq/intentd-releases#9, cloudlands-fe#10, myintentd#11, intent-hq/intent#12', []],
  ])('reads %j', (text, expected) => {
    expect(declaredIntentdPrs(text)).toEqual(expected);
  });
});

describe('intentd dependency evidence', () => {
  it('cuts when no fresh fe commit depends on unpublished intentd work', () => {
    const h = harness();
    expect(h.check()).toMatchObject({ safe: true });
    // One batched read of fresh PR bodies; old commits and release
    // automation are never inspected.
    expect(h.queries).toHaveLength(1);
    expect(h.queries[0]).toContain('p4326:');
    for (const skipped of ['p4300:', 'p4329:', 'p4330:'])
      expect(h.queries[0]).not.toContain(skipped);
  });

  it('defers on a declared runtime intentd PR that the pin lacks', () => {
    const h = harness();
    h.beFiles[3176].push({ filename: 'crates/intent-transport/src/browser.rs' });
    const result = h.check();
    expect(result.safe).toBe(false);
    expect(result.summary).toContain('#4326');
    expect(result.summary).toContain('intentd#3176');
    expect(result.summary).toContain('v0.11.160');
  });

  it('reads the dependency from the commit message as well as the PR body', () => {
    const h = harness();
    h.commits.push(commit('fix: direct push', '2026-11-09T06:00:00Z', 'Needs intentd#3200'));
    h.bePrs[3200] = { merged_at: '2026-11-09T05:00:00Z', merge_commit_sha: 'e'.repeat(40) };
    h.beFiles[3200] = [{ filename: 'crates/intent-core/src/lib.rs' }];
    h.contained['e'.repeat(40)] = 'diverged';
    expect(h.check()).toMatchObject({ safe: false });
  });

  // 2026-11-09: intentd#3170 changed only the assistant guide and a Rust test.
  it.each([
    [
      [
        'crates/intent-services/resources/assistant-app-guide.md',
        'crates/x/src/script_ops/monitor_tests.rs',
      ],
    ],
    [
      [
        'crates/x/tests/goldens/method_catalog.txt',
        'crates/x/src/tests.rs',
        'crates/x/src/a_test.rs',
      ],
    ],
    [['docs/a.txt', '.github/workflows/ci.yml', 'scripts/a.test.mjs']],
  ])('ignores a declared intentd PR that changes no runtime file: %j', (paths) => {
    const h = harness();
    h.beFiles[3176] = paths.map((filename) => ({ filename }));
    expect(h.check()).toMatchObject({ safe: true });
  });

  it.each([['crates/x/src/tester.rs'], ['crates/x/src/latest/mod.rs'], ['scripts/release.mjs']])(
    'counts %s as runtime',
    (filename) => {
      const h = harness();
      h.beFiles[3176] = [{ filename }];
      expect(h.check()).toMatchObject({ safe: false });
    },
  );

  it('cuts when the declared intentd PR is already in the pinned tag', () => {
    const h = harness();
    h.beFiles[3176] = [{ filename: 'crates/intent-core/src/lib.rs' }];
    h.contained['d'.repeat(40)] = 'behind';
    expect(h.check()).toMatchObject({ safe: true });
    h.contained['d'.repeat(40)] = 'identical';
    expect(h.check()).toMatchObject({ safe: true });
  });

  it('cuts when the declared intentd PR is unmerged, because waiting cannot ship it', () => {
    const h = harness();
    h.beFiles[3176] = [{ filename: 'crates/intent-core/src/lib.rs' }];
    h.bePrs[3176] = { merged_at: null, merge_commit_sha: null };
    expect(h.check()).toMatchObject({ safe: true });
  });

  it('walks every page of intentd PR files before calling it docs-only', () => {
    const h = harness();
    h.beFiles[3176] = Array.from({ length: 100 }, (_, i) => ({ filename: `docs/${i}.md` }));
    h.responses.set(`repos/${BE}/pulls/3176/files?per_page=100&page=2`, [
      { filename: 'crates/intent-core/src/lib.rs' },
    ]);
    expect(h.check()).toMatchObject({ safe: false });
  });

  it('walks every page of fe commits', () => {
    const h = harness();
    const page = Array.from({ length: 100 }, () =>
      commit('fix: bump intentd sidecar to v0.11.160'),
    );
    h.responses.set(`repos/${FE}/compare/${FE_TAG}...main?per_page=100&page=1`, { commits: page });
    h.responses.set(`repos/${FE}/compare/${FE_TAG}...main?per_page=100&page=2`, {
      commits: [commit('feat: browser (#4331)')],
    });
    h.fePrs[4331] = 'intent-hq/intentd#3184';
    h.bePrs[3184] = { merged_at: '2026-11-09T06:00:00Z', merge_commit_sha: 'f'.repeat(40) };
    h.beFiles[3184] = [{ filename: 'crates/intent-core/src/lib.rs' }];
    h.contained['f'.repeat(40)] = 'ahead';
    expect(h.check()).toMatchObject({ safe: false });
  });

  it.each([
    ['method', METHOD_GOLDEN, '+  await rpc("browser.pinTab", { id });'],
    ['event', EVENT_GOLDEN, '+  on(`agent:pinned`, refresh);'],
  ])('defers when the fe diff calls a new intentd %s the pin lacks', (_kind, golden, line) => {
    const h = harness();
    if (golden === METHOD_GOLDEN) h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    else h.catalog.main.events = events('agent:completed', 'agent:pinned');
    h.files.push({ filename: 'src/lib/browser.svelte', changes: 1, patch: `@@ -1 +1 @@\n${line}` });
    const result = h.check();
    expect(result.safe).toBe(false);
    expect(result.summary).toMatch(/browser\.pinTab|agent:pinned/);
  });

  it('ignores new protocol used only by fe tests', () => {
    const h = harness();
    h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    for (const filename of ['src/lib/a.test.ts', 'src/x/__tests__/b.ts', 'src/c.ct.spec.ts'])
      h.files.push({ filename, changes: 1, patch: "+rpc('browser.pinTab')" });
    expect(h.check()).toMatchObject({ safe: true });
  });

  it('cuts when intentd adds protocol the fe diff does not use', () => {
    const h = harness();
    h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    h.files.push({
      filename: 'src/lib/other.ts',
      changes: 2,
      patch: "@@ -1 +1 @@\n-rpc('browser.pinTab')\n+// browser.pinTab is unquoted here",
    });
    expect(h.check()).toMatchObject({ safe: true });
  });

  it.each([
    [
      'a truncated file list',
      (h: ReturnType<typeof harness>) => {
        h.files.push(
          ...Array.from({ length: 299 }, (_, i) => ({ filename: `assets/${i}.png`, changes: 1 })),
        );
      },
    ],
    [
      'a code file without a patch',
      (h: ReturnType<typeof harness>) => {
        h.files.push({ filename: 'src/lib/huge.ts', changes: 5000 });
      },
    ],
  ])('defers on new protocol with %s', (_name, setup) => {
    const h = harness();
    h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    setup(h);
    expect(h.check()).toMatchObject({ safe: false });
  });

  it('ignores patchless non-code files and unchanged renames', () => {
    const h = harness();
    h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    h.files.push({ filename: 'pnpm-lock.yaml', changes: 9000 });
    h.files.push({ filename: 'src/lib/moved.ts', changes: 0 });
    expect(h.check()).toMatchObject({ safe: true });
  });

  it.each([
    `repos/${FE}/compare/${FE_TAG}...main?per_page=100&page=1`,
    `repos/${BE}/pulls/3176`,
    `repos/${BE}/pulls/3176/files?per_page=100&page=1`,
    `repos/${BE}/contents/${METHOD_GOLDEN}?ref=${BASE}`,
    `repos/${BE}/contents/${EVENT_GOLDEN}?ref=main`,
  ])('keeps the deferral when %s is unreadable', (endpoint) => {
    const h = harness();
    h.responses.set(endpoint, new Error('HTTP 502'));
    expect(h.check()).toMatchObject({ safe: false });
  });

  it.each([
    ['an error', () => new Error('HTTP 502')],
    ['a missing PR', () => null],
  ])('keeps the deferral when fe PR bodies return %s', (_name, failure) => {
    const h = harness();
    const error = failure();
    if (error) h.failGraphql(error);
    else delete h.fePrs[4326];
    expect(h.check()).toMatchObject({ safe: false });
  });

  it('keeps the deferral when a fresh commit file list is unreadable', () => {
    const h = harness();
    h.catalog.main.methods = methods('agent.list', 'browser.pinTab');
    h.responses.set(`repos/${FE}/commits/${h.commits[1].sha}`, new Error('HTTP 502'));
    expect(h.check()).toMatchObject({ safe: false });
  });

  it('keeps the deferral on an unreadable containment check', () => {
    const h = harness();
    h.beFiles[3176] = [{ filename: 'crates/intent-core/src/lib.rs' }];
    h.responses.set(`repos/${BE}/compare/${BASE}...${'d'.repeat(40)}`, { status: 'weird' });
    expect(h.check()).toMatchObject({ safe: false });
  });

  it.each([
    { pin: 'latest' },
    { baselineSha: 'abc' },
    { feTag: 'main' },
    { cutoffEpoch: Number.NaN },
    { feRepo: 'fork/cloudlands-fe' },
  ])('rejects malformed input %j', (overrides) => {
    expect(harness().check(overrides)).toMatchObject({ safe: false });
  });

  it('keeps the deferral on a malformed golden', () => {
    const h = harness();
    h.catalog.main.events = '{"types": "nope"}';
    expect(h.check()).toMatchObject({ safe: false });
  });
});
