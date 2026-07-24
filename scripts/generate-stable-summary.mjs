#!/usr/bin/env node
/**
 * Generate Stable Promotion Summary
 *
 * Renders the leading summary section for the aggregated stable release notes:
 * the promoted FE version, the previous stable, and a consolidated intentd
 * section spanning the previous stable's pin → the promoted version's pin
 * (compare API, same rendering as the per-release notes via release-notes-lib).
 *
 * Everything except --version/--out is optional and degrades gracefully:
 * missing pins collapse to a pin line (or omit the intentd section entirely),
 * and compare-API failures fall back to the pin line + compare link, so a
 * notes problem never blocks a stable promotion (fail-soft).
 *
 * Usage:
 *   INTENTD_TOKEN=... node scripts/generate-stable-summary.mjs \
 *     --version 2.1.0 \
 *     [--prev-stable 2.0.7] \
 *     [--intentd-version 0.9.0] \
 *     [--intentd-base 0.8.0] \
 *     --out stable-summary.md
 *
 * Tokens:
 *   INTENTD_TOKEN — token for intent-hq/intentd API calls (compare API)
 *   GITHUB_TOKEN  — fallback when INTENTD_TOKEN is unset
 */

import { writeFileSync } from 'fs';
import {
  parseCommitMessage,
  shouldSkipCommit,
  renderIntentdSection,
} from './release-notes-lib.mjs';

/**
 * Parse CLI arguments
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        parsed[key] = value;
        i++;
      }
    }
  }

  return parsed;
}

/**
 * Normalize an optional version argument to a bare semver; invalid values are
 * warned about and ignored (fail-soft).
 * @param {string | undefined} value
 * @param {string} label - argument name for the warning message
 * @returns {string | null}
 */
function normalizeVersion(value, label) {
  if (!value) return null;
  const version = value.replace(/^v/, '');
  if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    return version;
  }
  console.warn(`⚠️ Ignoring invalid ${label} "${value}"`);
  return null;
}

/**
 * Fetch commits from GitHub compare API
 * @param {string} owner
 * @param {string} repo
 * @param {string} base
 * @param {string} head
 * @param {string} token
 * @returns {Promise<Array<{ commit: { message: string }, sha: string }>>}
 */
async function fetchCommits(owner, repo, base, head, token) {
  const commits = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}?per_page=${perPage}&page=${page}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'intent-release-notes-generator',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.commits && data.commits.length > 0) {
      commits.push(...data.commits);

      // If we got fewer commits than requested, we've reached the end
      if (data.commits.length < perPage) {
        break;
      }

      page++;
    } else {
      break;
    }
  }

  return commits;
}

/**
 * Build the consolidated intentd section for the stable range. Any failure
 * falls back to the pin line + compare link (no commit list) so a notes
 * problem never blocks a promotion (fail-soft).
 * @param {string} intentdVersion - promoted version's pin (bare semver)
 * @param {string | null} intentdBaseVersion - previous stable's pin (bare semver)
 * @returns {Promise<string>}
 */
async function buildIntentdSection(intentdVersion, intentdBaseVersion) {
  if (!intentdBaseVersion || intentdBaseVersion === intentdVersion) {
    return renderIntentdSection({ version: intentdVersion, baseVersion: intentdBaseVersion });
  }

  const token = process.env.INTENTD_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('⚠️ No INTENTD_TOKEN (or GITHUB_TOKEN fallback) available — skipping intentd delta fetch.');
    return renderIntentdSection({
      version: intentdVersion,
      baseVersion: intentdBaseVersion,
      commits: null,
    });
  }

  const baseTag = `v${intentdBaseVersion}`;
  const headTag = `v${intentdVersion}`;
  try {
    console.log(`Fetching intentd commits (${baseTag}...${headTag})...`);
    const intentdCommits = await fetchCommits('intent-hq', 'intentd', baseTag, headTag, token);
    console.log(`  Found ${intentdCommits.length} commits\n`);

    const parsedIntentdCommits = intentdCommits
      .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
      .filter(c => c && !shouldSkipCommit(c));

    return renderIntentdSection({
      version: intentdVersion,
      baseVersion: intentdBaseVersion,
      commits: parsedIntentdCommits,
    });
  } catch (error) {
    console.warn(`⚠️ Failed to fetch intentd delta (${baseTag}...${headTag}): ${error.message}`);
    console.warn('   Falling back to the pin line + compare link (no commit list).');
    return renderIntentdSection({
      version: intentdVersion,
      baseVersion: intentdBaseVersion,
      commits: null,
    });
  }
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();

  // Validate required args
  for (const key of ['version', 'out']) {
    if (!args[key]) {
      console.error(`Missing required argument: --${key}`);
      process.exit(1);
    }
  }

  const version = args.version.replace(/^v/, '');
  const prevStable = normalizeVersion(args['prev-stable'], '--prev-stable');
  const intentdVersion = normalizeVersion(args['intentd-version'], '--intentd-version');
  // A base pin without a head pin is unusable
  const intentdBaseVersion = intentdVersion
    ? normalizeVersion(args['intentd-base'], '--intentd-base')
    : null;

  console.log(`Generating stable promotion summary for Intent v${version}...\n`);

  const summaryLines = [
    `# Intent v${version} — stable promotion`,
    '',
    `- Promoted version: v${version}`,
    prevStable
      ? `- Previous stable: v${prevStable}`
      : '- Previous stable: none (first promotion)',
  ];

  if (intentdVersion) {
    if (intentdBaseVersion && intentdBaseVersion !== intentdVersion) {
      summaryLines.push(`- Backend daemon (intentd): v${intentdBaseVersion} → v${intentdVersion}`);
    } else if (intentdBaseVersion === intentdVersion) {
      summaryLines.push(`- Backend daemon (intentd): v${intentdVersion} (unchanged)`);
    } else {
      summaryLines.push(`- Backend daemon (intentd): v${intentdVersion}`);
    }
  }
  summaryLines.push('');

  const parts = [summaryLines.join('\n')];

  if (intentdVersion) {
    parts.push(await buildIntentdSection(intentdVersion, intentdBaseVersion));
  } else {
    console.warn('⚠️ No usable --intentd-version — omitting the consolidated intentd section.');
  }

  writeFileSync(args.out, parts.join('\n').trim() + '\n');
  console.log(`✅ Stable summary written to ${args.out}`);
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
