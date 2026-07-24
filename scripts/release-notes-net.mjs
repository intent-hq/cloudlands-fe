/**
 * Release Notes Generator - Network Helpers
 *
 * Shared GitHub API logic for the release-notes CLIs
 * (generate-release-notes.mjs and generate-stable-summary.mjs).
 * Pure rendering lives in release-notes-lib.mjs; this module owns the
 * network side so fixes (pagination, headers, timeouts) apply to both CLIs.
 */

import {
  parseCommitMessage,
  shouldSkipCommit,
  renderIntentdSection,
} from './release-notes-lib.mjs';

// Bound each API request so a hung connection degrades to the fail-soft
// fallback instead of stalling the workflow until its job timeout
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * @param {string} token
 * @returns {Record<string, string>}
 */
function githubHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'intent-release-notes-generator',
  };
}

/**
 * Resolve a git ref (tag, branch, or SHA) to a commit SHA
 * @param {string} owner
 * @param {string} repo
 * @param {string} ref
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function resolveCommitSha(owner, repo, ref, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`;

  const response = await fetch(url, {
    headers: githubHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
export async function fetchCommits(owner, repo, base, head, token) {
  const commits = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/compare/${base}...${head}?per_page=${perPage}&page=${page}`;

    const response = await fetch(url, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
 * Build the intentd section, fetching the commit delta from the compare API
 * when the pin moved. Any failure falls back to the pin line + compare link
 * (no commit list) so a notes problem never blocks a release (fail-soft).
 *
 * Tokens: INTENTD_TOKEN, with GITHUB_TOKEN as fallback.
 *
 * @param {{ version: string, baseVersion?: string | null }} params - bare semvers (no leading `v`)
 * @returns {Promise<string>}
 */
export async function buildIntentdSectionWithDelta({ version, baseVersion = null }) {
  if (!baseVersion || baseVersion === version) {
    return renderIntentdSection({ version, baseVersion });
  }

  const token = process.env.INTENTD_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('⚠️ No INTENTD_TOKEN (or GITHUB_TOKEN fallback) available — skipping intentd delta fetch.');
    return renderIntentdSection({ version, baseVersion, commits: null });
  }

  const baseTag = `v${baseVersion}`;
  const headTag = `v${version}`;
  try {
    console.log(`Fetching intentd commits (${baseTag}...${headTag})...`);
    const intentdCommits = await fetchCommits('intent-hq', 'intentd', baseTag, headTag, token);
    console.log(`  Found ${intentdCommits.length} commits\n`);

    const parsedIntentdCommits = intentdCommits
      .map(c => parseCommitMessage(c.commit.message.split('\n')[0]))
      .filter(c => c && !shouldSkipCommit(c));

    return renderIntentdSection({ version, baseVersion, commits: parsedIntentdCommits });
  } catch (error) {
    console.warn(`⚠️ Failed to fetch intentd delta (${baseTag}...${headTag}): ${error.message}`);
    console.warn('   Falling back to the pin line + compare link (no commit list).');
    return renderIntentdSection({ version, baseVersion, commits: null });
  }
}
