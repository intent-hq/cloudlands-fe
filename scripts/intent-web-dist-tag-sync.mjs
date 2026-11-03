#!/usr/bin/env node
// Decides whether .github/workflows/publish-intent-web.yml moves the npm
// dist-tag of a release channel: `beta` follows Promote Beta, `latest` follows
// Release Stable. The channel's update feed on intent-hq/cloudlands-releases
// is the source of truth, so a sync needs no inputs, is safe to rerun and
// repairs a missed one:
//   - skip when the tag already points at the channel version
//   - skip when the channel version is not on npm (older than the first publish)
//   - skip when the tag points at a newer version: tags never move backwards
// Writes `sync=true|false`, `version=<v>` and `dist_tag=<tag>` to
// $GITHUB_OUTPUT when set.
// Usage: node scripts/intent-web-dist-tag-sync.mjs <beta|stable>
//        node scripts/intent-web-dist-tag-sync.mjs --failure <version> <dist-tag>
//          prints the error for a rejected `npm dist-tag add` and exits 1
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PACKAGE_NAME, compareVersions, readRegistry } from './intent-web-publish-plan.mjs';

export const CHANNEL_DIST_TAGS = { beta: 'beta', stable: 'latest' };
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function distTagFor(channel) {
  if (!Object.hasOwn(CHANNEL_DIST_TAGS, channel))
    throw new Error(`Unknown channel '${channel}'. Expected one of: beta, stable.`);
  return CHANNEL_DIST_TAGS[channel];
}

export function channelFeedUrl(channel) {
  distTagFor(channel);
  return `https://github.com/intent-hq/cloudlands-releases/releases/download/${channel}/latest-mac.yml`;
}

// The top-level `version:` of an electron-updater feed.
export function feedVersion(text) {
  const match = /^version:[ \t]*['"]?([^'"\s]+)['"]?[ \t]*\r?$/m.exec(text);
  if (!match) throw new Error('The channel feed has no version line.');
  if (!SEMVER.test(match[1]))
    throw new Error(`The channel feed version is not semver: ${match[1]}`);
  return match[1];
}

// `registry` is null when the package is not on npm, else { versions, distTags }.
export function syncPlan(channel, version, registry) {
  const distTag = distTagFor(channel);
  if (!registry) return { sync: false, reason: `${PACKAGE_NAME} is not on npm yet` };
  if (!registry.versions.includes(version))
    return { sync: false, reason: `${PACKAGE_NAME}@${version} (${channel}) is not on npm` };
  const current = registry.distTags[distTag];
  if (current === version)
    return { sync: false, reason: `${distTag} already points at ${PACKAGE_NAME}@${version}` };
  if (current && compareVersions(version, current) < 0)
    return {
      sync: false,
      reason: `${distTag} points at ${PACKAGE_NAME}@${current}, newer than the ${channel} channel version ${version}; dist-tags never move backwards`,
    };
  return { sync: true, distTag, version };
}

const DIST_TAG_PERMISSION_CHANGELOG =
  'https://github.blog/changelog/2026-09-30-opt-in-dist-tag-permissions-for-npm-trusted-publishing/';

export function distTagFailure(version, distTag) {
  return [
    `npm rejected moving the ${distTag} dist-tag to ${PACKAGE_NAME}@${version}.`,
    `Check "Allow npm dist-tag" under Allowed actions on npmjs.com → ${PACKAGE_NAME} → Settings → Trusted Publisher (${DIST_TAG_PERMISSION_CHANGELOG}), then rerun this workflow,`,
    `or move it by hand as an @intent-hq owner: npm dist-tag add ${PACKAGE_NAME}@${version} ${distTag}`,
    '(docs/intent-web-package.md).',
  ].join(' ');
}

async function fetchChannelVersion(channel) {
  const url = channelFeedUrl(channel);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
  return feedVersion(await response.text());
}

if (
  import.meta.url === pathToFileURL(process.argv[1] ?? '').href &&
  process.argv[2] === '--failure'
) {
  const [version, distTag] = process.argv.slice(3);
  if (!version || !distTag)
    throw new Error('Usage: intent-web-dist-tag-sync.mjs --failure <version> <dist-tag>');
  console.log(`::error::${distTagFailure(version, distTag)}`);
  process.exit(1);
} else if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const channel = process.argv[2];
  if (!channel) throw new Error('Usage: intent-web-dist-tag-sync.mjs <beta|stable>');
  const version = await fetchChannelVersion(channel);
  const plan = syncPlan(channel, version, readRegistry());
  console.log(
    plan.sync
      ? `Moving dist-tag ${plan.distTag} to ${PACKAGE_NAME}@${version} (${channel} channel)`
      : `::notice::Skipping the ${channel} dist-tag sync: ${plan.reason}.`,
  );
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sync=${plan.sync}\nversion=${version}\ndist_tag=${plan.distTag ?? ''}\n`,
    );
}
