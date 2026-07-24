#!/usr/bin/env node
/**
 * Generate Release Notes
 *
 * Generates release notes from the cloudlands-fe commit range plus the pinned intentd
 * release version (intentd.version). Uses the GitHub REST API to fetch fe commits and
 * parse conventional commit messages; the intentd section references the pinned release
 * (intentd ships on its own release cycle) and, when the previous pin is known via
 * --intentd-base, lists the intentd commits in the `v<base>...v<head>` range.
 *
 * Usage:
 *   GITHUB_TOKEN=... node scripts/generate-release-notes.mjs \
 *     --version 2.0.6 \
 *     --fe-base v2.0.5 --fe-head v2.0.6 \
 *     --intentd-version 0.1.0 \
 *     [--intentd-base 0.0.9] \
 *     --out release-notes.md \
 *     --manifest-out release-manifest.json
 *
 * Tokens:
 *   FE_TOKEN      — token for intent-hq/cloudlands-fe API calls
 *   INTENTD_TOKEN — token for intent-hq/intentd API calls (compare API)
 *   GITHUB_TOKEN  — fallback when FE_TOKEN / INTENTD_TOKEN are unset
 */

import { writeFileSync } from 'fs';
import {
  parseCommitMessage,
  shouldSkipCommit,
  renderRepoNotes,
} from './release-notes-lib.mjs';
import {
  buildIntentdSectionWithDelta,
  fetchCommits,
  resolveCommitSha,
} from './release-notes-net.mjs';

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
  // Optional previous pin; invalid values are ignored (notes enrichment is fail-soft)
  let intentdBaseVersion = null;
  if (args['intentd-base']) {
    const base = args['intentd-base'].replace(/^v/, '');
    if (/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(base)) {
      intentdBaseVersion = base;
    } else {
      console.warn(`⚠️ Ignoring invalid --intentd-base "${args['intentd-base']}"`);
    }
  }

  console.log(`Generating release notes for Intent v${args.version}...\n`);

  console.log(`Fetching cloudlands-fe commits (${args['fe-base']}...${args['fe-head']})...`);
  const feCommits = await fetchCommits('intent-hq', 'cloudlands-fe', args['fe-base'], args['fe-head'], feToken);
  console.log(`  Found ${feCommits.length} commits\n`);

  // Parse and filter commits
  // Extract first line of commit message (GitHub API returns full message with body)
  const parsedFeCommits = feCommits
    .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
    .filter(c => c && !shouldSkipCommit(c));

  // Build the intentd section. When the previous pin is known and moved, the shared
  // helper fetches the commit delta from the intentd compare API; any failure falls
  // back to the pin line + compare link (no commit list) so a notes problem never
  // blocks a release (fail-soft).
  const intentdSection = await buildIntentdSectionWithDelta({
    version: intentdVersion,
    baseVersion: intentdBaseVersion,
  });

  const markdown = [
    `Intent v${args.version}`,
    '',
    renderRepoNotes('Desktop app (cloudlands-fe)', parsedFeCommits, 'intent-hq', 'cloudlands-fe'),
    intentdSection,
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
      ...(intentdBaseVersion ? { intentdBaseVersion } : {}),
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
