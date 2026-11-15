#!/usr/bin/env node
// Posts a short release announcement to the community Discord's #announcements
// channel after .github/workflows/announce-promotion.yml sees a successful
// Promote Beta or Release Stable run. Alpha releases are never announced.
// The channel's update feed on intent-hq/cloudlands-releases names the version
// (same source as the npm dist-tag sync), and the message links to the
// channel's rolling release notes.
// The webhook URL comes from DISCORD_ANNOUNCEMENTS_WEBHOOK; when it is unset
// the post is skipped with a notice, so forks and unconfigured repos stay green.
// A re-run of a promotion that already succeeded posts nothing: when
// PROMOTION_RUN_ATTEMPT > 1 the script asks the GitHub API whether an earlier
// attempt of PROMOTION_RUN_ID succeeded, and fails rather than guess when it
// cannot tell.
// Usage: node scripts/discord-promotion-announce.mjs <beta|stable> [--dry-run]
// DRY_RUN=true in the environment also prints the message without posting.
import { pathToFileURL } from 'node:url';
import { channelFeedUrl, feedVersion } from './intent-web-dist-tag-sync.mjs';

const CHANNELS = { beta: 'Beta', stable: 'Stable' };
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
const WEBHOOK_URL = /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

function channelLabel(channel) {
  if (!Object.hasOwn(CHANNELS, channel))
    throw new Error(`Unknown channel '${channel}'. Expected one of: beta, stable.`);
  return CHANNELS[channel];
}

export function channelReleaseUrl(channel) {
  channelLabel(channel);
  return `https://github.com/intent-hq/cloudlands-releases/releases/tag/${channel}`;
}

export function announcementMessage(channel, version) {
  const label = channelLabel(channel);
  if (!RELEASE_VERSION.test(version))
    throw new Error(`Not a release version: ${JSON.stringify(version)}`);
  const [emoji, detail] =
    channel === 'stable'
      ? [
          '🎉',
          'Intent updates itself automatically. New here? Download it at <https://intentapp.dev>.',
        ]
      : [
          '🧪',
          'Beta gets new features before Stable and may have rough edges. To try it, open Settings → General → Updates → Update channel and choose Beta.',
        ];
  return [
    `**Intent v${version} is now on the ${label} channel** ${emoji}`,
    detail,
    `What's new: <${channelReleaseUrl(channel)}>`,
  ].join('\n');
}

// allowed_mentions with an empty parse list stops the message from pinging
// anyone, whatever its text contains.
export function webhookPayload(channel, version) {
  return { content: announcementMessage(channel, version), allowed_mentions: { parse: [] } };
}

export function isDiscordWebhookUrl(url) {
  return WEBHOOK_URL.test(url ?? '');
}

// The earlier attempts of a promotion run that could already have announced.
export function earlierAttempts(attempt) {
  const n = Number(attempt);
  if (!Number.isInteger(n) || n < 1) return [];
  return Array.from({ length: n - 1 }, (_, i) => i + 1);
}

async function earlierAttemptSucceeded(repo, runId, attempt, token) {
  for (const n of earlierAttempts(attempt)) {
    const url = `https://api.github.com/repos/${repo}/actions/runs/${runId}/attempts/${n}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`Reading ${url} failed: HTTP ${response.status}`);
    if ((await response.json()).conclusion === 'success') return true;
  }
  return false;
}

async function fetchChannelVersion(channel) {
  const url = channelFeedUrl(channel);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
  return feedVersion(await response.text());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const channel = process.argv[2];
  const dryRun = process.argv.includes('--dry-run') || process.env.DRY_RUN === 'true';
  if (!channel) throw new Error('Usage: discord-promotion-announce.mjs <beta|stable> [--dry-run]');
  const { GITHUB_REPOSITORY, GH_TOKEN, PROMOTION_RUN_ID, PROMOTION_RUN_ATTEMPT } = process.env;
  if (
    PROMOTION_RUN_ID &&
    (await earlierAttemptSucceeded(
      GITHUB_REPOSITORY,
      PROMOTION_RUN_ID,
      PROMOTION_RUN_ATTEMPT,
      GH_TOKEN,
    ))
  ) {
    console.log(
      `::notice::An earlier attempt of promotion run ${PROMOTION_RUN_ID} already succeeded and was announced; skipping.`,
    );
    process.exit(0);
  }
  const payload = webhookPayload(channel, await fetchChannelVersion(channel));
  console.log(payload.content);
  const webhook = process.env.DISCORD_ANNOUNCEMENTS_WEBHOOK ?? '';
  if (dryRun) {
    console.log('::notice::Dry run: nothing was posted to Discord.');
  } else if (!webhook) {
    console.log('::notice::DISCORD_ANNOUNCEMENTS_WEBHOOK is not set; skipping the Discord post.');
  } else if (!isDiscordWebhookUrl(webhook)) {
    console.log('::error::DISCORD_ANNOUNCEMENTS_WEBHOOK is not a Discord webhook URL.');
    process.exit(1);
  } else {
    const response = await fetch(`${webhook}?wait=true`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.log(`::error::Discord rejected the announcement: HTTP ${response.status}`);
      process.exit(1);
    }
    console.log(`::notice::Announced the ${channel} promotion on Discord.`);
  }
}
