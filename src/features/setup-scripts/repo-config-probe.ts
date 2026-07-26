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
  /**
   * Only `'local'` and `'github'` are meaningful to the probe; other values
   * (e.g. the initializers' `'remote'` / `'new'`) pass through and disable it.
   */
  type: 'local' | 'github' | (string & {}) | null | undefined;
  githubUrl?: string | null;
  /**
   * Selected branch/ref. Part of the probe identity for GitHub selections
   * (monorepo#835): `.intent/config.json` can differ between branches, so a
   * branch change re-probes with the new ref and supersedes in-flight
   * results. Ignored for local repos (detection reads the working tree, not
   * a ref); empty/cleared means the repo's default branch (no ref sent).
   */
  branch?: string | null;
}

/**
 * Key for the selected repo itself (ref-independent). Keyed on repo
 * identity, not just path: for GitHub selections the path is the clone
 * destination, which two different repos can share. A branch change does NOT
 * change this key — use it for "did the user switch repos" decisions
 * (last-used restore, cache invalidation).
 */
export function repoIdentityKey(identity: RepoIdentity): string | null {
  return identity.type === 'github'
    ? `${identity.path}\u0000${identity.githubUrl || ''}`
    : identity.path;
}

/**
 * Staleness key for a probe run: the repo identity plus, for GitHub
 * selections, the selected branch/ref (monorepo#835) — a late response for a
 * superseded ref must never clobber newer state. A cleared branch keys as
 * the empty ref (repo default branch). Local probes ignore the branch.
 */
export function probeIdentityKey(identity: RepoIdentity): string | null {
  const repoKey = repoIdentityKey(identity);
  return identity.type === 'github' ? `${repoKey}\u0000${identity.branch || ''}` : repoKey;
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
  /**
   * Current repo identity (including the selected branch), for the
   * ref-aware staleness guard (read untracked).
   */
  getCurrentIdentity: () => RepoIdentity;
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
  const probeKey = probeIdentityKey(identity);

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
          identity.branch || undefined,
        );
    // Staleness guard: user switched repos — or, for GitHub, the branch —
    // while the read was in flight (compare the full ref-aware identity;
    // GitHub repos can share a clone path)
    const currentKey = untrack(() => probeIdentityKey(options.getCurrentIdentity()));
    if (currentKey !== probeKey) return;
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

/**
 * Debounce for branch-change re-probes (monorepo#835): rapid typing or
 * arrowing through the branch picker coalesces into a single
 * `github.repoConfig.get` request for the final ref.
 */
export const BRANCH_REPROBE_DEBOUNCE_MS = 300;

export interface RepoConfigProbeSelectionOptions
  extends Omit<RepoConfigProbeOptions, 'preservedRestoredState'> {
  /**
   * Called synchronously when the selected repo itself changed (not just the
   * branch), before the probe starts: invalidate cached repo-config state
   * and restore the last-used script here. `preservedRestoredState` is true
   * on the initial mount when a restored non-empty setup script must win
   * over the probe result.
   */
  onRepoChange: (context: { isInitialMount: boolean; preservedRestoredState: boolean }) => void;
}

/**
 * Stateful wrapper around {@link probeRepoConfigSetupScript} for the
 * initializer's repo/branch `$effect`. Call `onSelectionChange` on every
 * effect run with tracked identity reads (including the branch for GitHub
 * selections):
 *
 * - repo changed → run `onRepoChange` (restore/invalidate), probe at once;
 * - only the GitHub branch/ref changed → re-probe, debounced (#835) — the
 *   restored-state guard decided at repo selection keeps applying;
 * - nothing probe-relevant changed → no-op (a pending re-probe stays
 *   scheduled).
 *
 * Local repos never re-probe on branch changes: the branch is not part of
 * their probe key (detection reads the working tree, not a ref).
 *
 * Call `dispose` on component destroy (e.g. `onDestroy`) so a pending
 * debounced re-probe never fires against a destroyed component.
 */
export function createRepoConfigProbeScheduler(debounceMs = BRANCH_REPROBE_DEBOUNCE_MS) {
  let previousRepoKey: string | null = null;
  let previousProbeKey: string | null = null;
  let preservedRestoredState = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  return {
    onSelectionChange(options: RepoConfigProbeSelectionOptions): void {
      if (disposed) return;
      const { onRepoChange, ...probeOptions } = options;
      const repoKey = repoIdentityKey(options.identity);
      const probeKey = probeIdentityKey(options.identity);
      if (probeKey === previousProbeKey) return;
      previousProbeKey = probeKey;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }

      if (repoKey !== previousRepoKey) {
        const isInitialMount = previousRepoKey === null;
        previousRepoKey = repoKey;
        // Compute before onRepoChange runs the last-used restore, which
        // overwrites the setup script.
        preservedRestoredState =
          isInitialMount && !!untrack(probeOptions.getSetupScript).trim();
        onRepoChange({ isInitialMount, preservedRestoredState });
        probeRepoConfigSetupScript({ ...probeOptions, preservedRestoredState });
        return;
      }

      // Same repo, new branch/ref — debounced re-probe. The identity
      // snapshot cannot go stale in the timer: any further change re-runs
      // the effect, which reschedules (or cancels via the repo path above).
      timer = setTimeout(() => {
        timer = null;
        probeRepoConfigSetupScript({ ...probeOptions, preservedRestoredState });
      }, debounceMs);
    },

    /**
     * Cancel any pending debounced re-probe and refuse further scheduling
     * (component destroy).
     */
    dispose(): void {
      disposed = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
