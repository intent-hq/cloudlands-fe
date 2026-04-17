/**
 * Utility to generate `intent://create` deep link URLs for external services.
 *
 * Used by Augment's GitHub app (and similar integrations) to create
 * "Fix in Intent" links that open Intent with a pre-filled workspace.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Finding {
  file: string;
  line: number;
  message: string;
  suggestion?: string;
  severity?: string;
}

export interface GenerateFindingLinkOptions {
  /** Local repo path */
  repo?: string;
  /** GitHub repo URL (e.g. https://github.com/org/repo) */
  githubUrl?: string;
  /** Branch to work from */
  branch: string;
  /** The single finding to fix */
  finding: Finding;
  /** Agent specialist to use (e.g. "pr-shepherd") */
  specialist?: string;
}

export interface GenerateFixAllLinkOptions {
  repo?: string;
  githubUrl?: string;
  branch: string;
  /** All findings to fix */
  findings: Finding[];
  /** PR metadata */
  pr?: { number: number; url: string; title?: string };
  /** Agent specialist to use */
  specialist?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveRepoParam(repo?: string, githubUrl?: string): Record<string, string> {
  if (githubUrl) return { githubUrl };
  if (repo) return { repo };
  throw new Error('Either "repo" or "githubUrl" must be provided');
}

function formatFinding(f: Finding, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  const severity = f.severity ? ` [${f.severity}]` : '';
  let text = `${prefix}**${f.file}:${f.line}**${severity} — ${f.message}`;
  if (f.suggestion) {
    text += `\n   ${f.suggestion}`;
  }
  return text;
}

function buildUrl(params: Record<string, string>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, value);
    }
  }
  return `intent://create?${searchParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a deep link URL for fixing a single code-review finding.
 */
export function generateFindingLink(options: GenerateFindingLinkOptions): string {
  const { branch, finding, specialist } = options;
  const repoParams = resolveRepoParam(options.repo, options.githubUrl);

  const prompt = `Fix this code review finding:\n\n${formatFinding(finding)}`;

  const params: Record<string, string> = {
    ...repoParams,
    branch,
    prompt,
    newWindow: 'true',
    autoCreate: 'true',
  };

  if (specialist) params.specialist = specialist;

  return buildUrl(params);
}

/**
 * Generate a deep link URL for fixing all findings at once.
 */
export function generateFixAllLink(options: GenerateFixAllLinkOptions): string {
  const { branch, findings, pr, specialist } = options;
  const repoParams = resolveRepoParam(options.repo, options.githubUrl);

  if (findings.length === 0) {
    throw new Error('At least one finding is required');
  }

  let prompt: string;
  if (pr) {
    const titlePart = pr.title ? ` "${pr.title}"` : '';
    prompt = `Fix these code review findings on PR #${pr.number}${titlePart} (${pr.url}), branch ${branch}:\n\n`;
  } else {
    prompt = `Fix these code review findings on branch ${branch}:\n\n`;
  }

  prompt += findings.map((f, i) => formatFinding(f, i)).join('\n');
  prompt += '\n\nAfter fixing, commit the changes and push to the PR branch.';

  const params: Record<string, string> = {
    ...repoParams,
    branch,
    prompt,
    newWindow: 'true',
    autoCreate: 'true',
  };

  if (specialist) params.specialist = specialist;

  return buildUrl(params);
}
