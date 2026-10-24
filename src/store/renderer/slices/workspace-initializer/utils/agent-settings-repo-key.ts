/** The repository a New Workspace form is pointed at, as far as agent-settings memory cares. */
export interface AgentSettingsRepoIdentity {
  type: 'local' | 'github' | 'gitlab' | 'remote';
  /** Local path (local/remote) or the clone destination / shorthand (github). */
  path?: string | null;
  githubUrl?: string | null;
  remote?: { host?: string | null; workspacePath?: string | null } | null;
  gitlab?: { instanceBaseUrl?: string | null; projectPath?: string | null } | null;
}

const GITHUB_SHORTHAND = /^[\w.-]+\/[\w.-]+$/;

function trimTrailingSeparators(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  return trimmed || path.slice(0, 1);
}

/** `host/owner/repo` for a GitHub URL or `owner/repo` shorthand; the clone path never matters. */
function githubRepoSlug(url: string): string | null {
  let slug = url.trim().toLowerCase();
  slug = slug.replace(/^[a-z+]+:\/\//, '').replace(/^[^@/]+@([^:/]+):/, '$1/');
  slug = slug.replace(/^[^@/]+@/, '');
  slug = slug.replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = slug.split('/').filter(Boolean);
  if (parts.length === 2) return `github.com/${parts.join('/')}`;
  if (parts.length === 3 && parts[0].includes('.')) return parts.join('/');
  return null;
}

/**
 * Stable key the New Workspace form uses to remember the last agent setup
 * (mode, specialist, provider, model, reasoning effort) per repository.
 *
 * - GitHub clones share one key per `host/owner/repo`, whatever the clone path.
 * - Local repositories and worktrees are keyed by their own path, exactly.
 * - Remote (SSH) setups by host + remote path; GitLab checkouts by instance + project.
 *
 * Returns `null` when the identity is incomplete (nothing to remember yet).
 */
export function agentSettingsRepoKey(identity: AgentSettingsRepoIdentity): string | null {
  switch (identity.type) {
    case 'github': {
      const slug =
        (identity.githubUrl && githubRepoSlug(identity.githubUrl)) ||
        (identity.path && GITHUB_SHORTHAND.test(identity.path.trim())
          ? githubRepoSlug(identity.path)
          : null);
      return slug ? `github:${slug}` : null;
    }
    case 'local': {
      const path = identity.path?.trim();
      return path ? `local:${trimTrailingSeparators(path)}` : null;
    }
    case 'remote': {
      const host = identity.remote?.host?.trim().toLowerCase();
      const path = (identity.remote?.workspacePath || identity.path)?.trim();
      return host && path ? `remote:${host}:${trimTrailingSeparators(path)}` : null;
    }
    case 'gitlab': {
      const instance = identity.gitlab?.instanceBaseUrl?.trim().toLowerCase().replace(/\/+$/, '');
      const project = identity.gitlab?.projectPath
        ?.trim()
        .toLowerCase()
        .replace(/^\/+|\/+$/g, '');
      return instance && project ? `gitlab:${instance}/${project}` : null;
    }
  }
}
