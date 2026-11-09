#!/usr/bin/env node
// BE-dependency evidence for the auto-cut skew guard. The guard defers when
// intentd main is ahead of the pinned sidecar and the cut would ship fe
// commits merged after that tag. This helper looks for real dependencies
// instead of time overlap, and returns safe only on positive proof that
// none exists. Any unreadable input keeps the deferral.
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const BE = 'intent-hq/intentd';
const FE = 'intent-hq/cloudlands-fe';
export const METHOD_GOLDEN = 'crates/intent-transport/tests/goldens/method_catalog.txt';
export const EVENT_GOLDEN = 'crates/intent-core/tests/goldens/event_types.json';
const SHA = /^[0-9a-f]{40}$/;
const AUTOMATION = [/^fix: bump intentd sidecar to v/, /^chore\(release\): /];
const CODE = /\.(?:[cm]?[jt]sx?|svelte)$/;
// Files that never change the shipped daemon: docs, tests, CI config.
const NON_RUNTIME = [
  /\.md$/i,
  /^docs\//,
  /^\.github\//,
  /(^|\/)tests?\//,
  /(^|\/)tests?\.rs$/,
  /_tests?\.rs$/,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
];
const nonRuntime = (path) => NON_RUNTIME.some((re) => re.test(path));
// The compare API lists at most 300 files.
const FILE_CAP = 300;

function githubApi(endpoint) {
  return JSON.parse(
    execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

/** intentd PR numbers named in free text (PR bodies, commit messages). */
export function declaredIntentdPrs(text) {
  const pattern = /(?<![\w-])intentd(?:#|\/pull\/|\s+(?:PR\s*)?#)(\d+)/gi;
  return [...new Set([...String(text ?? '').matchAll(pattern)].map((m) => Number(m[1])))];
}

function pages(api, endpoint, pick) {
  const rows = [];
  for (let page = 1; page <= 30; page += 1) {
    const chunk = pick(api(`${endpoint}?per_page=100&page=${page}`));
    if (!Array.isArray(chunk)) throw new Error(`Unreadable listing ${endpoint}`);
    rows.push(...chunk);
    if (chunk.length < 100) return rows;
  }
  throw new Error(`Pagination limit reached for ${endpoint}`);
}

function readFile(api, path, ref) {
  const content = api(`repos/${BE}/contents/${path}?ref=${ref}`)?.content;
  if (typeof content !== 'string') throw new Error(`Unreadable ${path}@${ref}`);
  return Buffer.from(content, 'base64').toString('utf8');
}

function protocolNames(api, ref) {
  const methods = readFile(api, METHOD_GOLDEN, ref)
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => line.trim().split(/\s+/)[1]);
  const types = JSON.parse(readFile(api, EVENT_GOLDEN, ref))?.types;
  if (
    !methods.length ||
    methods.some((name) => !name) ||
    !Array.isArray(types) ||
    types.some((type) => typeof type !== 'string')
  )
    throw new Error(`Malformed protocol goldens at ${ref}`);
  return new Set([...methods, ...types]);
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function intentdDependencyEvidence(
  { pin, baselineSha, feTag, cutoffEpoch, feRepo },
  { api = githubApi, log = (line) => console.error(line) } = {},
) {
  const tag = `v${pin}`;
  try {
    if (
      !/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/.test(pin ?? '') ||
      !SHA.test(baselineSha ?? '') ||
      !/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(feTag ?? '') ||
      !Number.isFinite(cutoffEpoch) ||
      feRepo !== FE
    )
      throw new Error('Malformed arguments');

    const fresh = pages(api, `repos/${FE}/compare/${feTag}...main`, (data) => data?.commits)
      .filter((c) => Date.parse(c?.commit?.committer?.date) / 1000 > cutoffEpoch)
      .map((c) => String(c.commit.message ?? ''))
      .filter((message) => !AUTOMATION.some((re) => re.test(message.split('\n')[0])));

    // Declared: the fe PR (or commit) names an intentd PR that is merged,
    // missing from the pinned tag, and changes runtime files.
    const checked = new Map();
    for (const message of fresh) {
      const subject = message.split('\n')[0];
      const feNumber = subject.match(/\(#(\d+)\)$/)?.[1];
      let text = message;
      if (feNumber) {
        const body = api(`repos/${FE}/pulls/${feNumber}`)?.body;
        if (body !== null && typeof body !== 'string')
          throw new Error(`Unreadable fe #${feNumber}`);
        text += `\n${body ?? ''}`;
      }
      const label = feNumber ? `fe #${feNumber}` : `fe commit "${subject}"`;
      for (const number of declaredIntentdPrs(text)) {
        if (!checked.has(number)) {
          checked.set(number, unpublishedRuntimePr(api, number, baselineSha, log));
        }
        if (checked.get(number)) {
          return {
            safe: false,
            summary: `${label} names intentd#${number}, which is merged but not in the pinned ${tag}`,
          };
        }
      }
    }

    // Protocol: intentd main adds a method or event that the pin lacks, and
    // the fe diff since the last alpha adds a quoted use of it.
    const pinned = protocolNames(api, baselineSha);
    const added = [...protocolNames(api, 'main')].filter((name) => !pinned.has(name));
    if (added.length) {
      const files = api(`repos/${FE}/compare/${feTag}...main`)?.files;
      if (!Array.isArray(files)) throw new Error('Unreadable fe file list');
      if (files.length >= FILE_CAP) throw new Error('fe file list is truncated');
      const uses = added.map((name) => [name, new RegExp(`(['"\`])${escape(name)}\\1`)]);
      for (const file of files) {
        if (!CODE.test(file?.filename ?? '') || file.changes === 0) continue;
        if (typeof file.patch !== 'string') throw new Error(`No patch for ${file.filename}`);
        const lines = file.patch
          .split('\n')
          .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
        for (const [name, use] of uses) {
          if (lines.some((line) => use.test(line))) {
            return {
              safe: false,
              summary: `${file.filename} uses intentd protocol "${name}", which is on intentd main but not in the pinned ${tag}`,
            };
          }
        }
      }
    }

    return {
      safe: true,
      summary: `no fresh fe commit names unpublished intentd runtime work or uses protocol missing from ${tag}`,
    };
  } catch (error) {
    log(`Could not prove independence from unpublished intentd work (${error.message}).`);
    return { safe: false, summary: `dependency evidence is unreadable (${error.message})` };
  }
}

function unpublishedRuntimePr(api, number, baselineSha, log) {
  const pr = api(`repos/${BE}/pulls/${number}`);
  if (!pr || typeof pr !== 'object') throw new Error(`Unreadable intentd#${number}`);
  if (!pr.merged_at) {
    log(`intentd#${number} is not merged; the next intentd alpha cannot ship it either.`);
    return false;
  }
  if (!SHA.test(pr.merge_commit_sha ?? ''))
    throw new Error(`No merge commit for intentd#${number}`);
  const status = api(`repos/${BE}/compare/${baselineSha}...${pr.merge_commit_sha}`)?.status;
  if (status === 'behind' || status === 'identical') return false;
  if (status !== 'ahead' && status !== 'diverged')
    throw new Error(`Unreadable containment of intentd#${number}`);
  const files = pages(api, `repos/${BE}/pulls/${number}/files`, (data) => data);
  if (files.some((file) => typeof file?.filename !== 'string'))
    throw new Error(`Unreadable files of intentd#${number}`);
  if (files.every((file) => nonRuntime(file.filename))) {
    log(`intentd#${number} changes only docs, tests or CI; it does not gate the cut.`);
    return false;
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [pin, baselineSha, feTag, cutoff, feRepo] = process.argv.slice(2);
  const result = intentdDependencyEvidence({
    pin,
    baselineSha,
    feTag,
    cutoffEpoch: /^[0-9]+$/.test(cutoff ?? '') ? Number(cutoff) : Number.NaN,
    feRepo,
  });
  console.log(result.summary);
  process.exitCode = result.safe ? 0 : 1;
}
