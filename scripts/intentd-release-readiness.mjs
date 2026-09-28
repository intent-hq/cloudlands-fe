#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = 'intent-hq/intentd';
const WORKFLOW = '.github/workflows/release-plz.yml';
const MARKER = 'Release-plz no release needed: ';
const SHA = /^[0-9a-f]{40}$/;
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const successful = (value) => value?.status === 'completed' && value.conclusion === 'success';

function githubApi(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

// This is only positive proof for an exemption. Any missing/ambiguous response
// leaves the caller's existing skew decision intact, including on API errors.
export function confirmedIntentdNoop(
  { pin, baselineSha, feRepo },
  { api = githubApi, log = console.log } = {},
) {
  try {
    if (
      !/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(pin ?? '') ||
      !SHA.test(baselineSha ?? '') ||
      feRepo !== 'intent-hq/cloudlands-fe'
    )
      return false;

    const readHead = () => api(`repos/${REPO}/git/ref/heads/main`)?.object?.sha;
    const head = readHead();
    if (!SHA.test(head ?? '')) return false;
    const workflow = api(`repos/${REPO}/actions/workflows/release-plz.yml`);
    if (!positiveInteger(workflow?.id) || workflow.path !== WORKFLOW || workflow.state !== 'active')
      return false;

    // Enumerate completely; incomplete pagination must never hide a newer run
    // or an open release PR. The runs API itself caps filtered searches at 1000.
    const pages = (endpoint, key) => {
      const rows = [];
      for (let page = 1; page <= 10; page += 1) {
        const data = api(
          `${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`,
        );
        const chunk = key ? data?.[key] : data;
        if (
          !Array.isArray(chunk) ||
          (key &&
            (!Number.isSafeInteger(data.total_count) ||
              data.total_count < 0 ||
              data.total_count > 1000))
        )
          throw new Error('Unreadable or excessive pagination');
        rows.push(...chunk);
        if (chunk.length < 100) {
          if (key && rows.length !== data.total_count) throw new Error('Incomplete pagination');
          return rows;
        }
      }
      throw new Error('Pagination limit reached');
    };
    const trusted = (run) =>
      run?.workflow_id === workflow.id &&
      run.path === WORKFLOW &&
      run.event === 'push' &&
      run.head_branch === 'main' &&
      run.head_sha === head &&
      run.repository?.full_name === REPO &&
      run.head_repository?.full_name === REPO &&
      positiveInteger(run.id) &&
      positiveInteger(run.run_number) &&
      positiveInteger(run.run_attempt);
    const latestRun = () => {
      // Never filter by success: a newer pending/failed attempt invalidates proof.
      const runs = pages(
        `repos/${REPO}/actions/workflows/release-plz.yml/runs?branch=main&event=push&head_sha=${head}`,
        'workflow_runs',
      );
      if (!runs.every(trusted) || new Set(runs.map((r) => r.id)).size !== runs.length)
        throw new Error('Untrusted run listing');
      return runs.sort((a, b) => b.run_number - a.run_number)[0];
    };
    const run = latestRun();
    if (!run || !successful(run)) return false;
    const sameRun = (value) =>
      trusted(value) &&
      successful(value) &&
      value.id === run.id &&
      value.run_number === run.run_number &&
      value.run_attempt === run.run_attempt;
    if (!sameRun(api(`repos/${REPO}/actions/runs/${run.id}`))) return false;

    const jobs = pages(
      `repos/${REPO}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      'jobs',
    );
    const markers = jobs.filter(
      (job) => typeof job?.name === 'string' && job.name.startsWith(MARKER),
    );
    if (markers.length !== 1) return false;
    const marker = markers[0];
    if (
      marker.name !== `${MARKER}v${pin}@${baselineSha}` ||
      !successful(marker) ||
      marker.run_id !== run.id ||
      marker.run_attempt !== run.run_attempt ||
      marker.head_sha !== head
    )
      return false;

    const noReleasePr = () => {
      const prs = pages(`repos/${REPO}/pulls?state=open&base=main`);
      if (
        !prs.every(
          (pr) =>
            pr?.state === 'open' &&
            pr.base?.ref === 'main' &&
            typeof pr.head?.ref === 'string' &&
            typeof pr.head.repo?.full_name === 'string',
        )
      )
        throw new Error('Unreadable release PR listing');
      return !prs.some(
        (pr) => pr.head.repo.full_name === REPO && pr.head.ref.startsWith('release-plz-'),
      );
    };
    const samePin = () => {
      const data = api(`repos/${feRepo}/contents/intentd.version?ref=heads/main`);
      if (typeof data?.content !== 'string') return false;
      const lines = Buffer.from(data.content, 'base64')
        .toString('utf8')
        .split('\n')
        .filter((line) => !/^\s*(#|$)/.test(line))
        .map((line) => line.trim());
      return lines.length === 1 && lines[0] === pin;
    };
    const sameTag = () => api(`repos/${REPO}/commits/v${pin}`)?.sha === baselineSha;
    if (!noReleasePr() || !samePin() || !sameTag()) return false;

    // Bound races while fetching jobs: new runs, reruns, a release PR opening,
    // moved tags, and frontend pin/daemon main changes all invalidate the proof.
    if (
      !sameRun(latestRun()) ||
      !sameRun(api(`repos/${REPO}/actions/runs/${run.id}`)) ||
      !noReleasePr() ||
      !sameTag() ||
      !samePin() ||
      readHead() !== head
    )
      return false;
    return true;
  } catch (error) {
    log(
      `Could not confirm intentd release-plz no-op; retaining the dependency guard (${error.message}).`,
    );
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [pin, baselineSha, feRepo] = process.argv.slice(2);
  process.exitCode = confirmedIntentdNoop({ pin, baselineSha, feRepo }) ? 0 : 1;
}
