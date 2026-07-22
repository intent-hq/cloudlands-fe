#!/usr/bin/env node
/**
 * Generate Release Notes
 *
 * Generates release notes from the cloudlands-fe commit range plus the pinned intentd
 * release version (intentd.version). Uses the GitHub REST API to fetch fe commits and
 * parse conventional commit messages; the intentd section references the pinned release
 * instead of a commit SHA range (intentd ships on its own release cycle).
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/generate-release-notes.mjs \
 *     --version 2.0.6 \
 *     --fe-base v2.0.5 --fe-head v2.0.6 \
 *     --intentd-version 0.1.0 \
 *     --out release-notes.md \
 *     --manifest-out release-manifest.json
 *
 * Tokens:
 *   FE_TOKEN      — token for intent-hq/cloudlands-fe API calls
 *   GITHUB_TOKEN  — fallback when FE_TOKEN is unset
 */

import { writeFileSync } from 'fs';
import { parseCommitMessage, shouldSkipCommit, renderRepoNotes } from './release-notes-lib.mjs';

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
 * Resolve a git ref (tag, branch, or SHA) to a commit SHA
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} token
 * @returns {Promise<string>}
 */
async function resolveCommitSha(owner, repo, ref, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'intent-release-notes-generator',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error resolving ${ref}: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.sha;
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
 * Main function
 */
async function main() {
  const args = parseArgs();

  // Validate required args
  const required = ['version', 'fe-base', 'fe-head', 'intentd-version', 'out'];
  for (const key of required) {
    if (!args[key]) {
      console.error(`Missing required argument: --${key}`);
      process.exit(1);
    }
  }

  const feToken = process.env.FE_TOKEN || process.env.GITHUB_TOKEN;
  if (!feToken) {
    console.error('Missing FE_TOKEN (or GITHUB_TOKEN fallback) environment variable');
    process.exit(1);
  }

  // Normalize the pin to a bare semver; intentd release tags are `v<version>`
  const intentdVersion = args['intentd-version'].replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(intentdVersion)) {
    console.error(
      `Invalid --intentd-version "${args['intentd-version']}" (expected e.g. 1.2.3, 1.2.3-beta.1, or v1.2.3)`,
    );
    process.exit(1);
  }
  const intentdTag = `v${intentdVersion}`;

  console.log(`Generating release notes for Intent v${args.version}...\n`);

  console.log(`Fetching cloudlands-fe commits (${args['fe-base']}...${args['fe-head']})...`);
  const feCommits = await fetchCommits('intent-hq', 'cloudlands-fe', args['fe-base'], args['fe-head'], feToken);
  console.log(`  Found ${feCommits.length} commits\n`);

  // Parse and filter commits
  // Extract first line of commit message (GitHub API returns full message with body)
  const parsedFeCommits = feCommits
    .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
    .filter(c => c && !shouldSkipCommit(c));

  // Generate markdown; the intentd section references the pinned release (see its
  // release notes for backend changes) instead of rendering a commit range
  const markdown = [
    `Intent v${args.version}`,
    '',
    renderRepoNotes('Desktop app (cloudlands-fe)', parsedFeCommits, 'intent-hq', 'cloudlands-fe'),
    '## Backend daemon (intentd)',
    '',
    `Bundles the pinned [intentd ${intentdTag}](https://github.com/intent-hq/intentd/releases/tag/${intentdTag}) release.`,
    '',
  ].join('\n');

  // Write output
  writeFileSync(args.out, markdown.trim() + '\n');
  console.log(`✅ Release notes written to ${args.out}`);

  // Write manifest if requested
  if (args['manifest-out']) {
    // Resolve refs to actual commit SHAs
    console.log('Resolving commit SHAs for manifest...');
    const feSha = await resolveCommitSha('intent-hq', 'cloudlands-fe', args['fe-head'], feToken);

    const manifest = {
      version: args.version,
      // fe-head may be a raw SHA (the workflow passes the pre-bump commit), so derive
      // the tag name from the release version; feSha stays the precise identifier
      feTag: `v${args.version}`,
      feSha,
      intentdVersion,
      generatedAt: new Date().toISOString(),
    };

    writeFileSync(args['manifest-out'], JSON.stringify(manifest, null, 2) + '\n');
    console.log(`✅ Manifest written to ${args['manifest-out']}`);
  }
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
