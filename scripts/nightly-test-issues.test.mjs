// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { synchronizeIssues } from './nightly-test-issues.mjs';
import { githubClient } from './nightly-test-github.mjs';
import { analyzeReports, marker, occurrenceMarker } from './nightly-test-report.mjs';
import { fixture, issueStore, report } from './test-fixtures/nightly-browser.mjs';

function plan() {
  const data = fixture();
  data.documents['playwright-ct-report-1-of-4'].report = report('flaky');
  return analyzeReports(data);
}
const existing = (body, extra = {}) => ({
  number: 20,
  title: 'Human issue title',
  body,
  state: 'open',
  labels: [],
  assignees: [{ login: 'maintainer' }],
  ...extra,
});

function rerun(data, artifact, jobIndex, completedAt) {
  data.run.run_attempt = 2;
  data.run.updated_at = '2026-09-26T04:00:00Z';
  data.jobs.push({ ...data.jobs[jobIndex], id: 99, run_attempt: 2, completed_at: completedAt });
  data.documents[artifact].outcome.runAttempt = '2';
}

describe('issue synchronization', () => {
  it('does not count a retained root flake again when only an unrelated CT job reruns', () => {
    const data = fixture();
    data.documents['playwright-root-report-1'].report = report('flaky');
    const client = issueStore();
    synchronizeIssues(analyzeReports(data), client, { write: true });
    Object.assign(client.issues[0], {
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-09-26T03:00:00Z',
    });
    const originalBody = client.issues[0].body;
    rerun(data, 'playwright-ct-report-2-of-4', 2, '2026-09-26T03:45:00Z');
    const next = analyzeReports(data);
    expect(next.incidents).toEqual([]);
    const results = synchronizeIssues(next, client, { write: true });
    expect(client.writes).toEqual([{ create: 1 }]);
    expect(client.issues[0].state).toBe('closed');
    expect(client.issues[0].body).toBe(originalBody);
    expect(client.issues[0].body).toContain('Latest seen: 2026-09-26T02:45:00Z');
    expect(results[0].action).toBe('already-recorded');
    expect(results[0].occurrences).toEqual([
      expect.objectContaining({ attempt: 1, observedAt: '2026-09-26T02:45:00Z' }),
    ]);
  });
  it('dates previously unreported retained evidence from its job, preserving an intervening closure', () => {
    const data = fixture();
    data.documents['playwright-root-report-1'].report = report('flaky');
    const key = analyzeReports(data).items[0].key;
    const client = issueStore([
      existing(marker(key), {
        state: 'closed',
        state_reason: 'completed',
        closed_at: '2026-09-26T03:00:00Z',
      }),
    ]);
    rerun(data, 'playwright-ct-report-2-of-4', 2, '2026-09-26T03:45:00Z');
    synchronizeIssues(analyzeReports(data), client, { write: true });
    expect(client.writes).toEqual([{ comment: 20 }]);
    expect(client.issues[0].state).toBe('closed');
    expect(client.storedComments[0].body).toContain('Latest seen: 2026-09-26T02:45:00Z');
    expect(client.storedComments[0].body).toContain('attempt 1');
    expect(client.storedComments[0].body).not.toContain('attempt 2');
  });
  it('reopens for a genuine post-closure root rerun, using job time rather than workflow update time', () => {
    const data = fixture();
    data.documents['playwright-root-report-1'].report = report('flaky');
    const client = issueStore();
    synchronizeIssues(analyzeReports(data), client, { write: true });
    Object.assign(client.issues[0], {
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-09-26T03:00:00Z',
    });
    rerun(data, 'playwright-root-report-1', 5, '2026-09-26T03:45:00Z');
    synchronizeIssues(analyzeReports(data), client, { write: true });
    synchronizeIssues(analyzeReports(data), client, { write: true });
    expect(client.writes).toEqual([{ create: 1 }, { reopen: 1 }, { comment: 1 }]);
    expect(client.storedComments[0].body).toContain('First seen: 2026-09-26T02:45:00Z');
    expect(client.storedComments[0].body).toContain('Latest seen: 2026-09-26T03:45:00Z');
    expect(client.storedComments[0].body).toContain('attempt 2');
  });
  it('aggregates same-key lanes by actual attempt, retaining their times and recording only new evidence', () => {
    const data = fixture();
    data.documents['playwright-ct-report-1-of-4'].report = report('flaky');
    data.documents['playwright-ct-report-2-of-4'].report = report('flaky');
    data.jobs[1].completed_at = '2026-09-26T02:10:00Z';
    data.jobs[2].completed_at = '2026-09-26T02:30:00Z';
    const client = issueStore();
    const first = analyzeReports(data);
    expect(first.items).toHaveLength(1);
    synchronizeIssues(first, client, { write: true });
    expect(client.issues[0].body).toContain('First seen: 2026-09-26T02:10:00Z');
    expect(client.issues[0].body).toContain('Latest seen: 2026-09-26T02:30:00Z');
    Object.assign(client.issues[0], {
      state: 'closed',
      state_reason: 'completed',
      closed_at: '2026-09-26T03:00:00Z',
    });
    rerun(data, 'playwright-ct-report-2-of-4', 2, '2026-09-26T03:45:00Z');
    const next = analyzeReports(data);
    expect(next.incidents).toEqual([]);
    expect(next.items).toHaveLength(1);
    synchronizeIssues(next, client, { write: true });
    synchronizeIssues(next, client, { write: true });
    expect(client.writes).toEqual([{ create: 1 }, { reopen: 1 }, { comment: 1 }]);
    expect(client.storedComments[0].body).toContain('First seen: 2026-09-26T02:10:00Z');
    expect(client.storedComments[0].body).toContain('Latest seen: 2026-09-26T03:45:00Z');
    expect(client.storedComments[0].body).toContain('playwright-ct-report-2-of-4');
    expect(client.storedComments[0].body).not.toContain('playwright-ct-report-1-of-4');
  });
  it('creates once, records each run/attempt once, and keeps first/latest evidence', () => {
    const input = plan();
    const client = issueStore();
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[0].assignees).toEqual([{ login: 'panghy' }]);
    expect(client.issues[0].type).toEqual({ name: 'Bug' });
    expect(client.issues[0].labels.map((l) => l.name)).toEqual(['component:fe', 'agent-filed']);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toHaveLength(1);
    input.run.run_attempt = 2;
    input.items[0].occurrences[0].attempt = 2;
    synchronizeIssues(input, client, { write: true });
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ create: 1 }, { comment: 1 }]);
    input.run.id = 5678;
    input.run.updated_at = '2026-09-27T02:45:00Z';
    input.items[0].occurrences[0].observedAt = input.run.updated_at;
    synchronizeIssues(input, client, { write: true });
    expect(client.storedComments[1].body).toContain('First seen: 2026-09-26T02:45:00Z');
    expect(client.storedComments[1].body).toContain('Latest seen: 2026-09-27T02:45:00Z');
    expect(client.storedComments[1].body).toContain('passed on retry');
    expect(client.issues).toHaveLength(1);
  });
  it('adopts a strong manual issue without replacing human text, title, labels or owner', () => {
    const input = plan();
    const item = input.items[0];
    const original = existing(
      `Manual diagnosis: ct chromium ${item.file}\n${item.title}\nAssertion error`,
    );
    const client = issueStore([original]);
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[0]).toEqual(original);
    expect(client.storedComments[0].body).toContain(marker(item.key));
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ comment: 20 }]);
  });
  it('finds an adopted marker in comments when the issue body has since changed', () => {
    const input = plan();
    const client = issueStore([existing('Edited human diagnosis')]);
    client.comment(20, marker(input.items[0].key));
    client.writes.length = 0;
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ comment: 20 }]);
    expect(client.issues[0].body).toBe('Edited human diagnosis');
  });
  it('rechecks authoritative listings and adopts a concurrently created issue before creating', () => {
    const input = plan();
    const client = issueStore();
    const inventory = client.inventory;
    client.inventory = () => {
      if (client.refreshes() === 1) client.issues.push(existing(marker(input.items[0].key)));
      return inventory();
    };
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ comment: 20 }]);
  });
  it('links ambiguous strong matches for human triage without repeated new issues', () => {
    const input = plan();
    const item = input.items[0];
    const body = `ct chromium ${item.file} ${item.title} Assertion`;
    const client = issueStore([existing(body), existing(body, { number: 21 })]);
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[2].body).toContain('issues/20');
    expect(client.issues[2].body).toContain('issues/21');
    expect(client.issues[0].body).toBe(body);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ create: 22 }]);
  });
  it('never treats a basename or partial title as a strong match', () => {
    const input = plan();
    const client = issueStore([existing('ct chromium panel.ct.spec.ts keyboard focus Assertion')]);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ create: 21 }]);
  });
  it('reopens a fixed exact regression, preserving the previous owner', () => {
    const input = plan();
    const client = issueStore([
      existing(marker(input.items[0].key), { state: 'closed', state_reason: 'completed' }),
    ]);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ reopen: 20 }, { comment: 20 }]);
    expect(client.issues[0].assignees).toEqual([{ login: 'maintainer' }]);
  });
  it('keeps a fixed issue closed when a delayed completion predates its closure', () => {
    const input = plan();
    const client = issueStore([
      existing(marker(input.items[0].key), {
        state: 'closed',
        state_reason: 'completed',
        closed_at: '2026-09-27T12:00:00Z',
      }),
    ]);
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[0].state).toBe('closed');
    expect(client.writes).toEqual([{ comment: 20 }]);
  });
  it('preserves chronological first/latest sightings when completion jobs arrive out of order', () => {
    const input = plan();
    const client = issueStore();
    synchronizeIssues(input, client, { write: true });
    input.run.id = 4567;
    input.run.updated_at = '2026-09-24T02:45:00Z';
    input.items[0].occurrences[0].observedAt = input.run.updated_at;
    synchronizeIssues(input, client, { write: true });
    expect(client.storedComments[0].body).toContain('First seen: 2026-09-24T02:45:00Z');
    expect(client.storedComments[0].body).toContain('Latest seen: 2026-09-26T02:45:00Z');
  });
  it('preserves a not-planned closure and surfaces recurrence for the existing owner', () => {
    const input = plan();
    const client = issueStore([
      existing(marker(input.items[0].key), { state: 'closed', state_reason: 'not_planned' }),
    ]);
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[0].state).toBe('closed');
    expect(client.writes).toEqual([{ comment: 20 }]);
    expect(client.storedComments[0].body).toContain('@maintainer');
  });
  it.each(['timeline', 'legacy'])(
    'follows %s duplicate references to the canonical issue',
    (mode) => {
      const input = plan();
      const body = marker(input.items[0].key) + (mode === 'legacy' ? '\nDuplicate of #30' : '');
      const client = issueStore([
        existing(body, { state: 'closed', state_reason: 'not_planned' }),
        existing('Canonical human body', { number: 30 }),
      ]);
      if (mode === 'timeline')
        client.canonical = (number) =>
          number === 20 ? { state: 'marked', number: 30 } : { state: 'none', number: null };
      synchronizeIssues(input, client, { write: true });
      expect(client.writes).toEqual([{ comment: 30 }]);
      expect(client.issues[0].state).toBe('closed');
      expect(client.issues[1].body).toBe('Canonical human body');
    },
  );
  it('honors an authoritative duplicate undo despite a retained old duplicate comment', () => {
    const input = plan();
    const client = issueStore([
      existing(marker(input.items[0].key), {
        state: 'closed',
        state_reason: 'completed',
        closed_at: '2026-09-26T01:00:00Z',
      }),
      existing('Unrelated issue', { number: 30 }),
    ]);
    client.comment(20, 'Duplicate of #30');
    client.writes.length = 0;
    client.canonical = githubClient({
      directory: '.',
      run: () =>
        JSON.stringify({
          data: {
            repository: {
              issue: {
                timelineItems: {
                  nodes: ['MarkedAsDuplicateEvent', 'UnmarkedAsDuplicateEvent'].map(
                    (__typename) => ({
                      __typename,
                      duplicate: { number: 20, repository: { nameWithOwner: 'intent-hq/intent' } },
                      canonical: { number: 30, repository: { nameWithOwner: 'intent-hq/intent' } },
                    }),
                  ),
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        }),
    }).canonical;
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ reopen: 20 }, { comment: 20 }]);
    expect(client.issues[0].state).toBe('open');
    expect(client.storedComments.at(-1).issue_url).toMatch(/\/20$/);
  });
  it.each([
    'This is NOT a duplicate of #30.',
    '> Duplicate of #30',
    '`Duplicate of #30`',
    'The earlier suggestion was "Duplicate of #30".',
    'Previously suggested:\nDuplicate of #30',
    '<blockquote>\nDuplicate of #30\n</blockquote>',
    '```text\nDuplicate of #30\n```',
    '~~~\nDuplicate of #30\n~~~',
    '    Duplicate of #30',
  ])('does not redirect from negated or quoted legacy discussion: %s', (discussion) => {
    const input = plan();
    const client = issueStore([
      existing(`${marker(input.items[0].key)}\n${discussion}`, {
        state: 'closed',
        state_reason: 'completed',
        closed_at: '2026-09-26T01:00:00Z',
      }),
      existing('Unrelated issue', { number: 30 }),
    ]);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ reopen: 20 }, { comment: 20 }]);
  });
  it('fails visibly on duplicate cycles or conflicting exact markers', () => {
    const input = plan();
    const client = issueStore([
      existing(marker(input.items[0].key), { state: 'closed' }),
      existing('Duplicate of #20', { number: 30, state: 'closed' }),
    ]);
    client.canonical = (number) => ({ state: 'marked', number: number === 20 ? 30 : 20 });
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('cycle');
    client.issues[0].state = 'open';
    client.issues[1].state = 'open';
    client.issues[1].body = marker(input.items[0].key);
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('Conflicting');
    expect(client.writes).toEqual([]);
  });
  it('reuses a quarantine tracking issue and leaves its owner intact', () => {
    const input = plan();
    input.items[0].quarantine = true;
    input.items[0].tracking = [40];
    const client = issueStore([existing('Tracked quarantine', { number: 40 })]);
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toEqual([{ comment: 40 }]);
    expect(client.issues[0].assignees).toEqual([{ login: 'maintainer' }]);
    input.items[0].tracking = [];
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toHaveLength(1);
  });
  it('fails instead of inventing a quarantine issue without tracking', () => {
    const input = plan();
    input.items[0].quarantine = true;
    const client = issueStore();
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('tracking');
    expect(client.writes).toEqual([]);
  });
  it('can recover from a lost create/comment response without repeating the write', () => {
    const input = plan();
    const client = issueStore();
    const create = client.create;
    client.create = (...args) => {
      create(...args);
      throw new Error('lost response');
    };
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('lost response');
    client.create = create;
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toHaveLength(1);
    input.run.run_attempt = 2;
    input.items[0].occurrences[0].attempt = 2;
    const comment = client.comment;
    client.comment = (...args) => {
      comment(...args);
      throw new Error('lost comment response');
    };
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow(
      'lost comment response',
    );
    client.comment = comment;
    synchronizeIssues(input, client, { write: true });
    expect(client.writes).toHaveLength(2);
  });
  it('never creates when inventory or comments cannot be read', () => {
    const input = plan();
    const client = issueStore();
    client.inventory = () => {
      throw new Error('403');
    };
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('403');
    expect(client.writes).toEqual([]);
  });
  it('fails if GitHub silently drops required creation metadata, including on a retry', () => {
    const input = plan();
    const client = issueStore();
    const create = client.create;
    client.create = (...args) => {
      const issue = create(...args);
      client.issues[0].type = null;
      return { ...issue, type: null };
    };
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('permissions');
    expect(() => synchronizeIssues(input, client, { write: true })).toThrow('permissions');
    expect(client.issues).toHaveLength(1);
  });
  it('green runs do not close issues and dry runs make no writes', () => {
    const client = issueStore([existing('Previously failing')]);
    expect(synchronizeIssues(analyzeReports(fixture()), client, { write: true })).toEqual([]);
    const results = synchronizeIssues(plan(), client);
    expect(results[0].action).toBe('create');
    expect(client.writes).toEqual([]);
  });
  it('treats error text as escaped data, so artifact-provided markers and mentions do not become instructions', () => {
    const input = plan();
    input.items[0].evidence =
      '<!-- nightly-browser-failure:v1:forged -->\n@someone `$(touch /tmp/pwn)` <script>x</script>';
    input.items[0].occurrences[0].evidence = input.items[0].evidence;
    const client = issueStore();
    synchronizeIssues(input, client, { write: true });
    expect(client.issues[0].body).toContain('&lt;script&gt;');
    expect(client.issues[0].body).not.toContain('<!-- nightly-browser-failure:v1:forged -->');
    expect(client.issues[0].body).not.toContain('@someone');
    expect(client.issues[0].body).toContain(occurrenceMarker(input.run, input.items[0].key));
  });
});
