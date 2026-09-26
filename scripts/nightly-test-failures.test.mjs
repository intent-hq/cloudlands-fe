// @verify-changed-triggers: .github/workflows/nightly-browser-report.yml
// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from './nightly-test-failures.mjs';
import { githubClient } from './nightly-test-github.mjs';
import { analyzeReports, marker } from './nightly-test-report.mjs';
import { entries, fixture, report } from './test-fixtures/nightly-browser.mjs';
import { fakeGhPath } from './test-fixtures/nightly-gh.mjs';

const roots = [];
const temporary = () => {
  const root = mkdtempSync(join(tmpdir(), 'nightly-functional-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const script = resolve('scripts/nightly-test-failures.mjs');
const workflow = readFileSync(resolve('.github/workflows/nightly-browser-report.yml'), 'utf8');

function functional(data = fixture()) {
  const root = temporary();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const gh = join(bin, 'gh');
  writeFileSync(gh, `#!/usr/bin/env node\n${readFileSync(fakeGhPath, 'utf8')}`);
  chmodSync(gh, 0o755);
  const state = { ...data, calls: [], issues: [], comments: [], archives: {} };
  for (const artifact of data.artifacts) {
    const entry = entries.find((e) => e.artifactName === artifact.name);
    const doc = data.documents[artifact.name];
    const members = entry
      ? {
          [entry.outcomePath]: JSON.stringify(doc.outcome),
          [entry.reportPath]: JSON.stringify(doc.report),
        }
      : { 'browser-test-manifest.json': JSON.stringify(doc.manifest) };
    // A traversal filename and executable content must remain inert archive data.
    members['../../artifact-executed'] = 'do not extract';
    members['package.json'] = '{"scripts":{"postinstall":"touch artifact-executed"}}';
    const archive = join(root, `${artifact.id}.zip`);
    execFileSync(
      'python3',
      [
        '-c',
        'import json,sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"w") as z:\n for name,value in json.load(sys.stdin).items(): z.writestr(name,value)',
        archive,
      ],
      { input: JSON.stringify(members) },
    );
    state.archives[artifact.id] = archive;
  }
  const statePath = join(root, 'state.json');
  writeFileSync(statePath, JSON.stringify(state));
  const event = join(root, 'event.json');
  writeFileSync(event, JSON.stringify({ action: 'completed', workflow_run: data.run }));
  const out = join(root, 'output');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    NIGHTLY_FAKE_STATE: statePath,
    GH_TOKEN: 'fixture-token-not-a-real-credential',
    GITHUB_EVENT_NAME: 'workflow_run',
    GITHUB_REPOSITORY: 'intent-hq/cloudlands-fe',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_EVENT_PATH: event,
  };
  const readState = () => JSON.parse(readFileSync(statePath, 'utf8'));
  const update = (f) => {
    const next = readState();
    f(next);
    writeFileSync(statePath, JSON.stringify(next));
  };
  const call = (command, extra = [], override = {}) =>
    spawnSync(process.execPath, [script, command, '--out', out, ...extra], {
      env: { ...env, ...override },
      encoding: 'utf8',
    });
  return { root, out, env, call, update, readState };
}

describe('gh-only reporter functional workflow', () => {
  it('collects eight real ZIP reports, creates a Bug through fake gh, and replays without duplicate writes', () => {
    const data = fixture();
    data.documents['playwright-root-report-2'].report = report('flaky');
    const f = functional(data);
    expect(f.call('collect', ['--run', '1234']).status).toBe(0);
    const plan = JSON.parse(readFileSync(join(f.out, 'plan.json'), 'utf8'));
    expect(plan.lanes).toHaveLength(8);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].suite).toBe('root');
    expect(f.call('publish', ['--write']).status).toBe(0);
    expect(f.call('publish', ['--write']).status).toBe(0);
    const state = f.readState();
    expect(state.issues).toHaveLength(1);
    expect(state.comments).toHaveLength(0);
    expect(state.issues[0].type.name).toBe('Bug');
    expect(state.issues[0].assignees[0].login).toBe('panghy');
    expect(state.calls.filter((c) => c.method !== 'GET')).toHaveLength(1);
    expect(state.calls.some((c) => c.args[1].includes('filter=all'))).toBe(true);
    expect(existsSync(join(f.root, 'artifact-executed'))).toBe(false);
    expect(existsSync(join(f.out, 'package.json'))).toBe(false);
    expect(readFileSync(join(f.out, 'summary.md'), 'utf8')).toContain('issues/1');
  });
  it('finds old adopted markers beyond page one, without using eventually indexed search', () => {
    const data = fixture();
    data.documents['playwright-ct-report-1-of-4'].report = report('unexpected');
    const f = functional(data);
    expect(f.call('collect', ['--run', '1234']).status).toBe(0);
    const item = analyzeReports(data).items[0];
    f.update((s) => {
      s.issues = Array.from({ length: 101 }, (_, i) => ({
        number: i + 1,
        title: 'Unrelated',
        body: 'Human body',
        state: 'open',
        assignees: [{ login: 'original-owner' }],
      }));
      s.comments = Array.from({ length: 101 }, (_, i) => ({
        id: i + 1,
        issue_url: `https://api.github.com/repos/intent-hq/intent/issues/${i + 1}`,
        body: i === 100 ? marker(item.key) : 'unrelated',
      }));
    });
    expect(f.call('publish', ['--write']).status).toBe(0);
    const state = f.readState();
    expect(state.issues).toHaveLength(101);
    expect(state.comments.at(-1).issue_url).toContain('/101');
    expect(state.issues[100].assignees[0].login).toBe('original-owner');
    expect(state.calls.some((c) => c.args[1].includes('page=2'))).toBe(true);
    expect(state.calls.some((c) => c.args[1].includes('search'))).toBe(false);
  });
  it('preserves collected evidence and a failed summary on a permission error, then retries safely', () => {
    const data = fixture();
    data.documents['playwright-root-report-1'].report = report('unexpected');
    const f = functional(data);
    expect(f.call('collect', ['--run', '1234']).status).toBe(0);
    f.update((s) => {
      s.fail = ['repos/intent-hq/intent/issues'];
    });
    expect(f.call('publish', ['--write']).status).toBe(1);
    expect(readFileSync(join(f.out, 'summary.md'), 'utf8')).toContain('403');
    expect(existsSync(join(f.out, 'plan.json'))).toBe(true);
    expect(existsSync(join(f.out, '101.zip'))).toBe(true);
    f.update((s) => {
      s.fail = [];
    });
    expect(f.call('publish', ['--write']).status).toBe(0);
    expect(f.readState().issues).toHaveLength(1);
  });
  it('visibly fails and keeps run metadata when authoritative job history cannot be read', () => {
    const f = functional();
    f.update((s) => {
      s.fail = ['/jobs'];
    });
    expect(f.call('collect', ['--run', '1234']).status).toBe(1);
    expect(existsSync(join(f.out, 'run.json'))).toBe(true);
    expect(existsSync(join(f.out, 'error.json'))).toBe(true);
    expect(f.readState().issues).toEqual([]);
  });
  it('refuses evidence collected across a newly started source attempt', () => {
    const data = fixture();
    let calls = 0;
    const out = temporary();
    const client = {
      run: () => ({ ...data.run, run_attempt: ++calls === 1 ? 1 : 2 }),
      jobs: () => data.jobs,
      artifacts: () => data.artifacts,
      archive: (artifact) => data.documents[artifact.name],
    };
    expect(
      main(['collect', '--run', '1234', '--out', out], { createClient: () => client, env: {} }),
    ).toBe(1);
    expect(existsSync(join(out, 'documents.json'))).toBe(true);
    expect(existsSync(join(out, 'plan.json'))).toBe(false);
  });
  it('preserves corrupt ZIP evidence and reports an infrastructure incident', () => {
    const f = functional();
    writeFileSync(f.readState().archives[101], 'not a zip');
    expect(f.call('collect', ['--run', '1234']).status).toBe(0);
    const plan = JSON.parse(readFileSync(join(f.out, 'plan.json'), 'utf8'));
    expect(plan.items.map((i) => i.suite)).toEqual(['infrastructure']);
    expect(plan.incidents.join('\n')).toContain('Unreadable archive');
    expect(readFileSync(join(f.out, '101.zip'), 'utf8')).toBe('not a zip');
  });
  it.each([
    { GH_TOKEN: '' },
    { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'fork/repo' },
  ])('refuses writes outside trusted credentials/event scope: %j', (env) => {
    const root = temporary();
    writeFileSync(join(root, 'plan.json'), JSON.stringify(analyzeReports(fixture())));
    let called = false;
    const status = main(['publish', '--out', root, '--write'], {
      env,
      createClient: () => ({
        inventory: () => {
          called = true;
          throw new Error('unreachable');
        },
      }),
    });
    expect(status).toBe(1);
    expect(called).toBe(false);
  });
  it('historical diagnostics are read only even when someone requests write mode later', () => {
    const data = fixture();
    data.run.event = 'pull_request';
    const f = functional(data);
    expect(f.call('collect', ['--run', '1234']).status).toBe(1);
    expect(f.call('collect', ['--run', '1234', '--historical']).status).toBe(0);
    expect(f.call('publish', ['--write']).status).toBe(1);
    expect(f.readState().calls.every((c) => c.method === 'GET')).toBe(true);
  });
});

describe('GitHub API validation', () => {
  it('rejects missing issue bodies and incomplete comments instead of creating duplicates', () => {
    const client = githubClient({
      directory: temporary(),
      run: (args) =>
        JSON.stringify(
          args[1].includes('/issues/comments')
            ? []
            : [{ number: 1, title: 'Human title', state: 'open' }],
        ),
    });
    expect(() => client.inventory()).toThrow('Malformed issue');
    const comments = githubClient({
      directory: temporary(),
      run: () => JSON.stringify([{ id: 1 }]),
    });
    expect(() => comments.comments(1)).toThrow('Malformed comment');
  });
  it('fails on truncated or malformed paginated job history instead of accepting partial success', () => {
    const client = githubClient({
      directory: temporary(),
      run: () => JSON.stringify({ total_count: 2, jobs: [] }),
    });
    expect(() => client.jobs('1234')).toThrow('Truncated');
    const bad = githubClient({
      directory: temporary(),
      run: () => JSON.stringify({ total_count: 2 }),
    });
    expect(() => bad.jobs('1234')).toThrow('Unreadable');
  });
  it('paginates duplicate history and follows only canonical references for the matched duplicate', () => {
    const calls = [];
    const client = githubClient({
      directory: temporary(),
      run: (args, options) => {
        const input = JSON.parse(options.input);
        calls.push(input);
        return JSON.stringify({
          data: {
            repository: {
              issue: {
                timelineItems: {
                  nodes: input.variables.cursor
                    ? [
                        {
                          __typename: 'MarkedAsDuplicateEvent',
                          duplicate: {
                            number: 20,
                            repository: { nameWithOwner: 'intent-hq/intent' },
                          },
                          canonical: {
                            number: 30,
                            repository: { nameWithOwner: 'intent-hq/intent' },
                          },
                        },
                      ]
                    : [],
                  pageInfo: { hasNextPage: !input.variables.cursor, endCursor: 'page2' },
                },
              },
            },
          },
        });
      },
    });
    expect(client.canonical(20)).toBe(30);
    expect(calls.map((c) => c.variables.cursor)).toEqual([null, 'page2']);
  });
});

describe('trusted workflow execution policy', () => {
  const expression = / {4}if: >-\n((?: {6}.*\n)+)/.exec(workflow)[1].trim();
  const evaluate = new Function('github', `return (${expression})`);
  it('serializes all source runs and retries without cancelling pending reports', () => {
    const concurrency = /^concurrency:\n((?: {2}.+\n)+)/m.exec(workflow)[1];
    const policy = Object.fromEntries(
      concurrency
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/: */)),
    );
    // A literal group shares the writer across nightly/manual runs and attempts.
    // GitHub's default single pending slot drops reports even when cancellation is false.
    expect(policy).toEqual({
      group: 'nightly-browser-issue-writer',
      queue: 'max',
      'cancel-in-progress': 'false',
    });
  });
  it.each(['success', 'failure', 'cancelled'])(
    'processes %s conclusions for trusted nightly and manual runs',
    (conclusion) => {
      for (const event of ['schedule', 'workflow_dispatch'])
        expect(
          evaluate({
            repository: 'intent-hq/cloudlands-fe',
            event: { workflow_run: { ...fixture().run, event, conclusion } },
          }),
        ).toBe(true);
    },
  );
  it.each([
    { event: 'pull_request' },
    { event: 'merge_group' },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/repo' } },
  ])('excludes untrusted source %j before a writer is started', (source) => {
    expect(
      evaluate({
        repository: 'intent-hq/cloudlands-fe',
        event: { workflow_run: { ...fixture().run, ...source } },
      }),
    ).toBe(false);
  });
});
