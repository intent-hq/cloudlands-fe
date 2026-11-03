#!/usr/bin/env node
// Decides whether .github/workflows/publish-intent-web.yml publishes
// @intent-hq/web@<version>, and under which dist-tag:
//   - skip when that version is already on npm (reruns are safe)
//   - fail when the package does not exist yet: trusted publishing needs the
//     one-time manual bootstrap publish (docs/intent-web-package.md)
//   - `alpha` for the newest version; `backfill` for an older tag rebuilt by
//     hand, so a rerun never moves `alpha` backwards; `next` for prereleases
//   - never `beta` or `latest`: those follow the Promote Beta and Release
//     Stable channels (scripts/intent-web-dist-tag-sync.mjs)
// Writes `publish=true|false` and `dist_tag=<tag>` to $GITHUB_OUTPUT when set.
// Usage: node scripts/intent-web-publish-plan.mjs <version>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PACKAGE_NAME = '@intent-hq/web';
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(version) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`Not a semver version: ${version}`);
  return { core: match.slice(1, 4).map(Number), pre: match[4] ?? null };
}

// Semver precedence, enough for release tags: core triple, then a release
// outranks its prereleases, then prerelease identifiers left to right.
export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 3; i += 1)
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  const ids = [left.pre.split('.'), right.pre.split('.')];
  for (let i = 0; i < Math.max(ids[0].length, ids[1].length); i += 1) {
    const [x, y] = [ids[0][i], ids[1][i]];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)];
    if (nx && ny) return Number(x) - Number(y);
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

// `registry` is null when the package is not on npm, else { versions, distTags }.
export function publishPlan(version, registry) {
  parse(version);
  if (!registry)
    throw new Error(
      `${PACKAGE_NAME} is not on npm yet. Trusted publishing cannot create a package: do the one-time bootstrap publish described in docs/intent-web-package.md, then rerun this workflow.`,
    );
  if (registry.versions.includes(version))
    return { publish: false, reason: `${PACKAGE_NAME}@${version} is already published` };
  if (parse(version).pre !== null) return { publish: true, distTag: 'next' };
  const alpha = registry.distTags.alpha;
  if (alpha && compareVersions(version, alpha) < 0) return { publish: true, distTag: 'backfill' };
  return { publish: true, distTag: 'alpha' };
}

function npmView(field) {
  const result = spawnSync('npm', ['view', PACKAGE_NAME, field, '--json'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const out = result.stdout.trim();
  const body = out ? JSON.parse(out) : null;
  if (result.status === 0) return { body };
  if (body?.error?.code === 'E404') return { missing: true };
  throw new Error(`npm view ${PACKAGE_NAME} ${field} failed:\n${result.stdout}\n${result.stderr}`);
}

export function readRegistry() {
  const versions = npmView('versions');
  if (versions.missing) return null;
  const tags = npmView('dist-tags');
  const list = versions.body === null ? [] : [versions.body].flat();
  const distTags = tags.body && typeof tags.body === 'object' ? tags.body : {};
  return { versions: list, distTags };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const version = process.argv[2];
  if (!version) throw new Error('Usage: intent-web-publish-plan.mjs <version>');
  const plan = publishPlan(version, readRegistry());
  console.log(
    plan.publish
      ? `Publishing ${PACKAGE_NAME}@${version} with dist-tag ${plan.distTag}`
      : `Skipping: ${plan.reason}`,
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `publish=${plan.publish}\ndist_tag=${plan.distTag ?? ''}\n`,
    );
}
