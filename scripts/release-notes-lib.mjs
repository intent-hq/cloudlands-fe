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
  
  const sections = [
    { title: 'Features', commits: groups.feat },
    { title: 'Bug Fixes', commits: groups.fix },
    { title: 'Performance', commits: groups.perf },
    { title: 'Refactor', commits: groups.refactor },
    { title: 'Docs', commits: groups.docs },
    { title: 'Other', commits: groups.other },
  ];
  
  const hasChanges = commits.length > 0;
  
  let output = `## ${repoName}\n\n`;
  
  if (!hasChanges) {
    output += 'No changes.\n';
  } else {
    for (const { title, commits: sectionCommits } of sections) {
      output += renderSection(title, sectionCommits, repoOwner, repoSlug);
    }
  }
  
  return output;
}
