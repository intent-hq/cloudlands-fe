/**
 * Release Notes Generator - Core Logic
 * 
 * Pure functions for parsing, grouping, and rendering release notes.
 * No network calls or side effects - those are in generate-release-notes.mjs
 */

/**
 * Parse a conventional commit message
 * Format: type(scope)!?: subject (#N)
 * @param {string} message - Commit message
 * @returns {{ type: string, scope: string | null, breaking: boolean, subject: string, prNumber: number | null } | null}
 */
export function parseCommitMessage(message) {
  // Match: type(scope)!?: subject (#123)
  // type(scope): subject (#123)
  // type!: subject (#123)
  // type: subject (#123)
  const match = message.match(/^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+?)(?:\s+\(#(\d+)\))?$/);
  
  if (!match) {
    return null;
  }

  const [, type, scope, breaking, subject, prNumber] = match;

  return {
    type: type.toLowerCase(),
    scope: scope || null,
    breaking: !!breaking,
    subject: subject.trim(),
    prNumber: prNumber ? parseInt(prNumber, 10) : null,
  };
}

/**
 * Check if a commit should be skipped
 * @param {ReturnType<typeof parseCommitMessage>} parsed
 * @returns {boolean}
 */
export function shouldSkipCommit(parsed) {
  if (!parsed) return true;
  
  // Skip chore(release) commits
  if (parsed.type === 'chore' && parsed.scope === 'release') {
    return true;
  }
  
  // Skip version bump commits (common patterns in subject line)
  const versionBumpPatterns = [
    /^bump version to/i,
    /^version \d+\.\d+\.\d+/i,
  ];

  return versionBumpPatterns.some(pattern => pattern.test(parsed.subject));
}

/**
 * Section rendering order shared by the repo and intentd renderers:
 * display title per conventional-commit group key
 */
const SECTION_ORDER = [
  { title: 'Features', type: 'feat' },
  { title: 'Bug Fixes', type: 'fix' },
  { title: 'Performance', type: 'perf' },
  { title: 'Refactor', type: 'refactor' },
  { title: 'Docs', type: 'docs' },
  { title: 'Other', type: 'other' },
];

/**
 * Group commits by type
 * @param {Array<ReturnType<typeof parseCommitMessage>>} commits
 * @returns {Record<string, Array<ReturnType<typeof parseCommitMessage>>>}
 */
export function groupCommitsByType(commits) {
  const groups = {
    feat: [],
    fix: [],
    perf: [],
    refactor: [],
    docs: [],
    other: [],
  };

  for (const commit of commits) {
    if (!commit) continue;
    
    const type = commit.type;
    if (type in groups) {
      groups[type].push(commit);
    } else {
      groups.other.push(commit);
    }
  }

  return groups;
}

/**
 * Render a commit entry as markdown
 * @param {ReturnType<typeof parseCommitMessage>} commit
 * @param {string} repoOwner - GitHub repo owner
 * @param {string} repoName - GitHub repo name
 * @returns {string}
 */
export function renderCommitEntry(commit, repoOwner, repoName) {
  if (!commit) return '';
  
  let line = `- ${commit.subject}`;
  
  if (commit.prNumber) {
    const prUrl = `https://github.com/${repoOwner}/${repoName}/pull/${commit.prNumber}`;
    line += ` ([#${commit.prNumber}](${prUrl}))`;
  }
  
  return line;
}

/**
 * Render a section of commits
 * @param {string} title - Section title (e.g., "Features")
 * @param {Array<ReturnType<typeof parseCommitMessage>>} commits
 * @param {string} repoOwner
 * @param {string} repoName
 * @returns {string}
 */
export function renderSection(title, commits, repoOwner, repoName) {
  if (commits.length === 0) return '';
  
  const lines = [`### ${title}`, ''];
  
  for (const commit of commits) {
    lines.push(renderCommitEntry(commit, repoOwner, repoName));
  }
  
  lines.push('');
  return lines.join('\n');
}

/**
 * Render release notes for a single repository
 * @param {string} repoName - Display name (e.g., "Desktop app (cloudlands-fe)")
 * @param {Array<ReturnType<typeof parseCommitMessage>>} commits
 * @param {string} repoOwner
 * @param {string} repoSlug - Repo name for URLs
 * @returns {string}
 */
export function renderRepoNotes(repoName, commits, repoOwner, repoSlug) {
  const groups = groupCommitsByType(commits);

  const hasChanges = commits.length > 0;

  let output = `## ${repoName}\n\n`;

  if (!hasChanges) {
    output += 'No changes.\n';
  } else {
    for (const { title, type } of SECTION_ORDER) {
      output += renderSection(title, groups[type], repoOwner, repoSlug);
    }
  }

  return output;
}

/**
 * Render the intentd (backend daemon) section of the release notes
 *
 * Three shapes depending on what is known about the previous pin:
 * - no baseVersion: pin line only (first release / previous pin unrecoverable)
 * - baseVersion === version: "intentd unchanged" line
 * - baseVersion !== version: pin line with previous version + compare link,
 *   followed by the grouped commit sections (same style as the FE section)
 *
 * @param {{ version: string, baseVersion?: string | null, commits?: Array<ReturnType<typeof parseCommitMessage>> | null }} params
 *   version/baseVersion are bare semvers (no leading `v`); commits are parsed
 *   and pre-filtered conventional commits for the `v<base>...v<head>` range.
 *   Pass commits: null when the delta could not be fetched — the pin line and
 *   compare link are still rendered, without a commit list (or a misleading
 *   "No changes." claim)
 * @returns {string}
 */
export function renderIntentdSection({ version, baseVersion = null, commits = [] }) {
  const tag = `v${version}`;
  const tagUrl = `https://github.com/intent-hq/intentd/releases/tag/${tag}`;
  const lines = ['## Backend daemon (intentd)', ''];

  if (!baseVersion) {
    lines.push(`Bundles the pinned [intentd ${tag}](${tagUrl}) release.`, '');
    return lines.join('\n');
  }

  if (baseVersion === version) {
    lines.push(`intentd unchanged ([${tag}](${tagUrl})).`, '');
    return lines.join('\n');
  }

  const baseTag = `v${baseVersion}`;
  const compareUrl = `https://github.com/intent-hq/intentd/compare/${baseTag}...${tag}`;
  lines.push(
    `Bundles [intentd ${tag}](${tagUrl}) (previously ${baseTag}) — [full changelog (${baseTag}...${tag})](${compareUrl}).`,
    '',
  );

  if (commits === null) {
    return lines.join('\n');
  }

  if (commits.length === 0) {
    lines.push('No changes.', '');
    return lines.join('\n');
  }

  const groups = groupCommitsByType(commits);
  for (const { title, type } of SECTION_ORDER) {
    const section = renderSection(title, groups[type], 'intent-hq', 'intentd');
    if (section) {
      lines.push(section);
    }
  }

  return lines.join('\n');
}
