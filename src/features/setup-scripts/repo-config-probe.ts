/**
 * Shared repo-config detection probe for the workspace initializers
 * (OnboardingPage and CompactWorkspaceInitializer) — extracted per
 * intent-hq/monorepo#833 so the spinner state, no-clobber guards, and
 * repo-identity staleness key cannot silently diverge between the two
 * call sites.
 *
 * The probe reads the repo's committed `.intent/config.json` for a setup
 * script: local repos read the file directly (absolute paths only — `~`
 * never expands in host.exec argv, no shell); GitHub repos have no local
 * checkout, so the daemon reads it via `github.repoConfig.get`
 * (PROTOCOL §5.27 v2.4).
 */
import { untrack } from 'svelte';
import { parseGitHubUrl } from '$lib/utils/workspace-validation';
import { fetchGitHubRepoConfigSetupScript, fetchRepoConfigSetupScript } from './repo-config';

/**
 * The selected repo's identity as seen by the initializer form. `githubUrl`
 * matters because for GitHub selections `path` is the clone destination,
 * which two different repos can share.
 */
export interface RepoIdentity {
  path: string | null;
  type: string | null | undefined;
  githubUrl?: string | null;
}

/**
 * Staleness key for a repo selection. Keyed on repo identity, not just path:
 * for GitHub selections the path is the clone destination, which two
 * different repos can share.
 */
export function repoIdentityKey(identity: RepoIdentity): string | null {
  return identity.type === 'github'
    ? `${identity.path}\u0000${identity.githubUrl || ''}`
    : identity.path;
}

export interface RepoConfigProbeOptions {
  /** Repo identity snapshot taken when the effect ran (tracked reads). */
  identity: RepoIdentity;
  /**
   * True when restored form state must win over the probe result (initial
   * mount with a non-empty setup script). The probe still runs and caches
   * its result; it just never applies the script.
   */
  preservedRestoredState: boolean;
  /** Current repo identity, for the staleness guard (read untracked). */
  getCurrentIdentity: () => RepoIdentity;
  /** Selected branch, forwarded as the GitHub probe `ref` (read untracked). */
  getBranch: () => string | null | undefined;
  /** Current setup-script content (read untracked). */
  getSetupScript: () => string;
  /** Whether the setup-script modal is open (read untracked). */
  isSetupScriptModalOpen: () => boolean;
  /** Whether the user picked/edited a custom script (read untracked). */
  isCustomSetupScript: () => boolean;
  /** Spinner on the setup-script control. */
  setLoading: (loading: boolean) => void;
  /**
   * Probe settled for the still-selected repo: cache `script` (may be null)
   * alongside the repo it was fetched for so stale results are never applied.
   */
  onProbeResult: (script: string | null) => void;
  /** Apply the repo-config script as the form's setup script. */
  applyScript: (script: string) => void;
}

/**
 * Probe the repo's committed `.intent/config.json` for a setup script and
 * apply it unless a guard forbids it. Call from the initializer's
 * repo-change `$effect` after the last-used script has been restored; the
 * synchronous portion runs inside the effect, so state the effect must NOT
 * depend on is read through the untracked getters.
 *
 * Silent degradation: a missing config, auth failure, or transport error
 * folds to "no script" in the fetch helpers — never an error here.
 */
export function probeRepoConfigSetupScript(options: RepoConfigProbeOptions): void {
  const { identity, preservedRestoredState } = options;
  const { path, type } = identity;
  const repoKey = repoIdentityKey(identity);

  options.setLoading(false);
  const isLocalProbe = !!path && type === 'local' && path.startsWith('/');
  const github =
    !!path && type === 'github' ? parseGitHubUrl(identity.githubUrl || path) : null;
  if (!isLocalProbe && !github) return;
  const scriptAtFetchStart = untrack(options.getSetupScript);
  options.setLoading(true);
  void (async () => {
    const script = isLocalProbe
      ? await fetchRepoConfigSetupScript(path)
      : await fetchGitHubRepoConfigSetupScript(
          github!.owner,
          github!.repo,
          untrack(options.getBranch) || undefined,
        );
    // Staleness guard: user switched repos while the read was in flight
    // (compare full repo identity — GitHub repos can share a clone path)
    const currentKey = untrack(() => repoIdentityKey(options.getCurrentIdentity()));
    if (currentKey !== repoKey) return;
    options.setLoading(false);
    options.onProbeResult(script);
    if (!script) return;
    // Repo config has top priority, but never clobber restored form state,
    // user edits, an open setup-script modal (it snapshots parent values on
    // open and would commit stale ones on Done), or anything changed while
    // the read was in flight
    if (preservedRestoredState) return;
    if (untrack(options.isSetupScriptModalOpen)) return;
    if (untrack(options.isCustomSetupScript)) return;
    if (untrack(options.getSetupScript) !== scriptAtFetchStart) return;
    options.applyScript(script);
  })();
}
