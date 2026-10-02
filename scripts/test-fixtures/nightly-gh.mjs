// Executed as a fake `gh` by the functional tests. No network fallback.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fakeGhPath = fileURLToPath(import.meta.url);

function main() {
  const path = process.env.NIGHTLY_FAKE_STATE;
  const state = JSON.parse(readFileSync(path, 'utf8'));
  const args = process.argv.slice(2);
  const endpoint = args[1];
  const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
  const body = args.includes('--input') ? JSON.parse(readFileSync(0, 'utf8')) : undefined;
  state.calls.push({ args, method, body });
  const finish = (result) => {
    writeFileSync(path, JSON.stringify(state));
    process.stdout.write(Buffer.isBuffer(result) ? result : JSON.stringify(result));
    process.exit(0);
  };
  if (args[0] !== 'api' || state.fail?.some((s) => endpoint.includes(s))) {
    writeFileSync(path, JSON.stringify(state));
    process.stderr.write('simulated HTTP 403');
    process.exit(1);
  }
  const url = new URL(endpoint, 'https://api.github.com/');
  const page = Number(url.searchParams.get('page') ?? 1);
  const paged = (items) => items.slice((page - 1) * 100, page * 100);
  const source = '/repos/intent-hq/cloudlands-fe';
  const tracker = '/repos/intent-hq/intent';
  if (url.pathname === `${source}/actions/runs/${state.run.id}`) finish(state.run);
  if (url.pathname.endsWith(`/actions/runs/${state.run.id}/jobs`))
    finish({ total_count: state.jobs.length, jobs: paged(state.jobs) });
  if (url.pathname.endsWith(`/actions/runs/${state.run.id}/artifacts`))
    finish({ total_count: state.artifacts.length, artifacts: paged(state.artifacts) });
  const archive = /\/actions\/artifacts\/(\d+)\/zip$/.exec(url.pathname);
  if (archive) finish(readFileSync(state.archives[archive[1]]));
  if (url.pathname === `${tracker}/issues`) {
    if (method === 'GET') finish(paged(state.issues));
    if (method === 'POST') {
      if (
        body.type !== 'Bug' ||
        body.assignees[0] !== 'panghy' ||
        body.labels.join(',') !== 'component:fe,agent-filed'
      )
        throw new Error('Wrong creation contract');
      const issue = {
        number: state.issues.length + 1,
        title: body.title,
        body: body.body,
        state: 'open',
        type: { name: body.type },
        assignees: body.assignees.map((login) => ({ login })),
        labels: body.labels.map((name) => ({ name })),
      };
      state.issues.push(issue);
      finish(issue);
    }
  }
  if (url.pathname === `${tracker}/issues/comments`) finish(paged(state.comments));
  const issueRoute = /\/issues\/(\d+)(\/comments)?$/.exec(url.pathname);
  if (issueRoute) {
    const number = Number(issueRoute[1]);
    const issue = state.issues.find((i) => i.number === number);
    if (!issue) throw new Error('Unknown fake issue');
    if (issueRoute[2]) {
      if (method === 'GET')
        finish(paged(state.comments.filter((c) => c.issue_url.endsWith(`/${number}`))));
      const comment = {
        id: state.comments.length + 1,
        body: body.body,
        issue_url: `https://api.github.com${tracker}/issues/${number}`,
      };
      state.comments.push(comment);
      finish(comment);
    }
    if (method === 'PATCH') Object.assign(issue, body);
    finish(issue);
  }
  throw new Error(`Unexpected fake gh request: ${endpoint}`);
}

if (process.env.NIGHTLY_FAKE_STATE) main();
