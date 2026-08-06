/**
 * Repo preselection for a pending GitHub issue/PR prefill (chat link action
 * menu → "Start new workspace…"): picks the repository matching the link's
 * `owner/repo`.
 *
 * Matching order:
 *  1. Recent/local candidates whose known GitHub metadata (recent-repo
 *     `owner`/`name` or `githubUrl`) or detected git remote (probed via the
 *     injected `probeRemote`, backed by `git-tracking:get-remote-url`)
 *     matches `owner/repo` → that repo.
 *  2. No match → the GitHub clone flow with
 *     `https://github.com/{owner}/{repo}` and a clone path derived from the
 *     default parent path.
 *  3. Any probe/matching error → `keep` (non-fatal; the caller leaves the
 *     current/last-used repo selected).
 *
 * Pure and dependency-light per FE conventions: the IPC probe is injected.
 */

export interface GitHubPrefillRepoCandidate {
  path: string;
  type: 'local' | 'github';
  name?: string;
  owner?: string;
  githubUrl?: string;
}

export type GitHubPrefillRepoSelection =
  | { kind: 'local'; path: string }
  | { kind: 'clone'; githubUrl: string; clonePath: string }
  | { kind: 'keep' };

export interface MatchGitHubPrefillRepoInput {
  owner: string;
  repo: string;
  candidates: GitHubPrefillRepoCandidate[];
  /** Parent folder for the clone-flow fallback path (defaults to ~/Developer). */
  defaultParentPath?: string;
  /** Resolve a local repo's GitHub remote; null when none is detected. */
  probeRemote: (repoPath: string) => Promise<{ owner: string; repo: string } | null>;
}

/** Cap remote probes so a long recent-repos list cannot fan out IPC calls. */
const MAX_REMOTE_PROBES = 10;

const DEFAULT_CLONE_PARENT = '~/Developer';

function normalizeRepoName(name: string): string {
  return name.replace(/\.git$/i, '').toLowerCase();
}

/** Extract owner/repo from a GitHub URL (https or ssh form). */
function parseGitHubOwnerRepo(url: string): { owner: string; repo: string } | null {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s#?]+)/i.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/** Known owner/repo for a candidate from its stored metadata, if conclusive. */
function candidateMetadataOwnerRepo(
  candidate: GitHubPrefillRepoCandidate,
): { owner: string; repo: string } | null {
  if (candidate.githubUrl) return parseGitHubOwnerRepo(candidate.githubUrl);
  if (candidate.owner && candidate.name) return { owner: candidate.owner, repo: candidate.name };
  return null;
}

function isMatch(
  detected: { owner: string; repo: string },
  target: { owner: string; repo: string },
): boolean {
  return (
    detected.owner.toLowerCase() === target.owner &&
    normalizeRepoName(detected.repo) === target.repo
  );
}

/** Join parent path + folder name using the platform's native separator. */
function joinNativePath(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/';
  const cleanParent = parent.replace(/[/\\]$/, '');
  return `${cleanParent}${sep}${name}`;
}

function toSelection(
  candidate: GitHubPrefillRepoCandidate,
  githubUrl: string,
): GitHubPrefillRepoSelection {
  if (candidate.type === 'github') {
    return { kind: 'clone', githubUrl: candidate.githubUrl ?? githubUrl, clonePath: candidate.path };
  }
  return { kind: 'local', path: candidate.path };
}

export async function matchGitHubPrefillRepo({
  owner,
  repo,
  candidates,
  defaultParentPath,
  probeRemote,
}: MatchGitHubPrefillRepoInput): Promise<GitHubPrefillRepoSelection> {
  const cleanRepoName = repo.replace(/\.git$/i, '');
  const githubUrl = `https://github.com/${owner}/${cleanRepoName}`;
  try {
    const target = { owner: owner.toLowerCase(), repo: normalizeRepoName(repo) };
    const seen = new Set<string>();
    const unresolved: GitHubPrefillRepoCandidate[] = [];

    // Pass 1: candidates with conclusive stored metadata — no IPC needed.
    for (const candidate of candidates) {
      if (!candidate.path || seen.has(candidate.path)) continue;
      seen.add(candidate.path);
      const meta = candidateMetadataOwnerRepo(candidate);
      if (meta) {
        if (isMatch(meta, target)) return toSelection(candidate, githubUrl);
        continue; // metadata is conclusive — a mismatch needs no probe
      }
      if (candidate.type === 'local') unresolved.push(candidate);
    }

    // Pass 2: probe remaining local candidates' git remotes.
    for (const candidate of unresolved.slice(0, MAX_REMOTE_PROBES)) {
      const detected = await probeRemote(candidate.path);
      if (detected && isMatch(detected, target)) {
        return { kind: 'local', path: candidate.path };
      }
    }

    // No local match → GitHub clone flow.
    return {
      kind: 'clone',
      githubUrl,
      clonePath: joinNativePath(defaultParentPath || DEFAULT_CLONE_PARENT, cleanRepoName),
    };
  } catch {
    // Matching failed — keep the current/last-used repo (non-fatal).
    return { kind: 'keep' };
  }
}
