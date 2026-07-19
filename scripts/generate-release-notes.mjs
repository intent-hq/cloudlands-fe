#!/usr/bin/env node
/**
 * Generate Release Notes
 *
 * Generates release notes by comparing commit ranges across cloudlands-fe and intentd repos.
 * Uses the GitHub REST API to fetch commits and parse conventional commit messages.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/generate-release-notes.mjs \
 *     --version 2.0.6 \
 *     --fe-base v2.0.5 --fe-head v2.0.6 \
 *     --intentd-base <sha> --intentd-head <sha> \
 *     --out release-notes.md \
 *     --manifest-out release-manifest.json
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
 * Fetch commits from GitHub compare API
 * @param {string} owner
 * @param {string} repo
 * @param {string} base
 * @param {string} head
 * @param {string} token
 * @returns {Promise<Array<{ commit: { message: string } }>>}
 */
async function fetchCommits(owner, repo, base, head, token) {
  const commits = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}?per_page=${perPage}&page=${page}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'intent-release-notes-generator',
      },
    });

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (data.commits && data.commits.length > 0) {
      commits.push(...data.commits);
    }

    // GitHub compare API returns all commits in one response, not paginated
    break;
  }

  return commits;
}

/**
 * Main function
 */
async function main() {
  const args = parseArgs();

  // Validate required args
  const required = ['version', 'fe-base', 'fe-head', 'intentd-base', 'intentd-head', 'out'];
  for (const key of required) {
    if (!args[key]) {
      console.error(`Missing required argument: --${key}`);
      process.exit(1);
    }
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('Missing GITHUB_TOKEN environment variable');
    process.exit(1);
  }

  console.log(`Generating release notes for Intent v${args.version}...\n`);

  // Fetch commits from both repos
  console.log(`Fetching cloudlands-fe commits (${args['fe-base']}...${args['fe-head']})...`);
  const feCommits = await fetchCommits('intent-hq', 'cloudlands-fe', args['fe-base'], args['fe-head'], token);
  console.log(`  Found ${feCommits.length} commits\n`);

  console.log(`Fetching intentd commits (${args['intentd-base']}...${args['intentd-head']})...`);
  const intentdCommits = await fetchCommits('intent-hq', 'intentd', args['intentd-base'], args['intentd-head'], token);
  console.log(`  Found ${intentdCommits.length} commits\n`);

  // Parse and filter commits
  // Extract first line of commit message (GitHub API returns full message with body)
  const parsedFeCommits = feCommits
    .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
    .filter(c => c && !shouldSkipCommit(c));

  const parsedIntentdCommits = intentdCommits
    .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
    .filter(c => c && !shouldSkipCommit(c));

  // Generate markdown
  const markdown = [
    `Intent v${args.version}`,
    '',
    renderRepoNotes('Desktop app (cloudlands-fe)', parsedFeCommits, 'intent-hq', 'cloudlands-fe'),
    renderRepoNotes('Backend daemon (intentd)', parsedIntentdCommits, 'intent-hq', 'intentd'),
  ].join('\n');

  // Write output
  writeFileSync(args.out, markdown.trim() + '\n');
  console.log(`✅ Release notes written to ${args.out}`);

  // Write manifest if requested
  if (args['manifest-out']) {
    const manifest = {
      version: args.version,
      feTag: args['fe-head'],
      feSha: feCommits.length > 0 ? feCommits[feCommits.length - 1].sha : args['fe-head'],
      intentdSha: args['intentd-head'],
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
