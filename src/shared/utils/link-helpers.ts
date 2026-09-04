import type { WorkspaceId } from '$shared/types/branded-ids';

export const GITHUB_LINK_DEFAULT_ACTIONS = [
  'show-choices',
  'open-in-browser',
  'open-in-app',
  'copy-link',
  'start-workspace',
] as const;

export type GithubLinkDefaultAction = (typeof GITHUB_LINK_DEFAULT_ACTIONS)[number];

export function isGithubLinkDefaultAction(value: unknown): value is GithubLinkDefaultAction {
  return GITHUB_LINK_DEFAULT_ACTIONS.includes(value as GithubLinkDefaultAction);
}

/** Modifier key flags extracted from a mouse or keyboard event. */
interface ModifierFlags {
  metaKey?: boolean;
  ctrlKey?: boolean;
}

export interface LinkHandlerOptions {
  /** Workspace ID for panel layout manager lookup. When undefined, HTTP/HTTPS links fall back to the external browser. */
  workspaceId?: WorkspaceId;
  /** Panel where the navigation originated. Used to resolve stacked panel layouts. */
  sourcePanelId?: string;
  /** The raw (unresolved) `href` attribute of the clicked anchor, e.g. `src/main.rs`.
   *  Used to detect schemeless path-like targets that the DOM resolves against the app's own origin. */
  rawHref?: string;
  /** The original activation event (used to detect Mod-click and Mod+Enter). */
  event?: MouseEvent | KeyboardEvent;
  /** Explicitly open internal note/task links beside the source panel. */
  openInAdjacentPanel?: boolean;
  /** Create a new adjacent panel instead of reusing an existing neighbor. */
  openInNewAdjacentPanel?: boolean;
  /** Extracted modifier flags — alternative to passing the full event */
  modifiers?: ModifierFlags;
  /** Force external browser even for HTTP/HTTPS links */
  forceExternal?: boolean;
  /** Override the persisted plain-click action for GitHub issue and PR links. */
  githubLinkDefaultAction?: GithubLinkDefaultAction;
  /** Custom handler for specific link types */
  customHandler?: (url: string) => Promise<boolean> | boolean;
}

/** Path segments that indicate an OAuth / authentication flow */
const AUTH_PATH_PATTERNS = ['/oauth', '/authorize', '/login/oauth', '/auth/'];

/** Detect whether a URL is an OAuth / authentication URL. */
export function isAuthUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    const lower = pathname.toLowerCase();
    return AUTH_PATH_PATTERNS.some((pattern) => lower.includes(pattern));
  } catch {
    return false;
  }
}

/** Detect whether a URL points to GitHub. */
export function isGitHubUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'github.com' || hostname.endsWith('.github.com');
  } catch {
    return false;
  }
}

/** Parse a canonical GitHub repository URL or unambiguous owner/name shorthand. */
export function parseGitHubUrl(value: string): { owner: string; repo: string } | null {
  const trimmed = value.trim();
  const shorthand = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/.exec(trimmed);
  if (shorthand) return { owner: shorthand[1], repo: shorthand[2] };

  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(trimmed);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const withScheme = /^github\.com\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const parsed = new URL(withScheme);
    if (!['github.com', 'www.github.com'].includes(parsed.hostname.toLowerCase())) return null;
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return null;
    const [owner, rawRepo] = segments;
    const repo = rawRepo.replace(/\.git$/i, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(owner) || !/^[a-zA-Z0-9_.-]+$/.test(repo)) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

/** Kind of a parsed GitHub issue/PR reference. */
type GitHubIssueOrPrKind = 'issue' | 'pr';

/** A GitHub issue or pull-request reference parsed from a github.com URL. */
export interface GitHubIssueOrPrRef {
  owner: string;
  repo: string;
  number: number;
  kind: GitHubIssueOrPrKind;
}

/**
 * Parse a GitHub issue or pull-request URL.
 *
 * Matches `github.com/{owner}/{repo}/issues/{n}` and
 * `github.com/{owner}/{repo}/pull/{n}` (plus `www.github.com`), tolerating
 * trailing path segments (e.g. `/pull/1/files`), query strings, and anchors.
 * Returns null for any other GitHub or non-GitHub URL.
 */
export function parseGitHubIssueOrPrUrl(url: string): GitHubIssueOrPrRef | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length < 4) return null;
    const [owner, repo, kindSegment, numberSegment] = segments;
    const kind = kindSegment === 'issues' ? 'issue' : kindSegment === 'pull' ? 'pr' : null;
    if (!kind) return null;
    if (!/^\d+$/.test(numberSegment)) return null;
    return { owner, repo, number: Number.parseInt(numberSegment, 10), kind };
  } catch {
    return null;
  }
}

/** Detect whether the platform-appropriate "Cmd" modifier is held. */
export function isCmdClickModifier(
  options: Pick<LinkHandlerOptions, 'event' | 'modifiers'>,
  platform = typeof navigator !== 'undefined' ? navigator.platform : undefined,
): boolean {
  const flags: ModifierFlags = options.modifiers ?? options.event ?? {};
  const isMac = typeof platform === 'string' && platform.toUpperCase().includes('MAC');
  return isMac ? !!flags.metaKey : !!flags.ctrlKey;
}
