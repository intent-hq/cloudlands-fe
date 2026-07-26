/**
 * Tests for the shared repo-config detection probe (monorepo#833): the
 * ref-aware probe identity/staleness keys, local/GitHub probe routing,
 * spinner state, the no-clobber guards (restored form state, user edits,
 * open setup-script modal, stale results after a repo switch), and the
 * branch-change re-probe scheduler (monorepo#835).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$shared/generated/ipc-client', () => ({
  invoke: vi.fn(async () => ({ success: false })),
}));

const fetches = vi.hoisted(() => ({
  local: vi.fn<(repoPath: string) => Promise<string | null>>(),
  github: vi.fn<(owner: string, repo: string, ref?: string) => Promise<string | null>>(),
}));

vi.mock('./repo-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./repo-config')>()),
  fetchRepoConfigSetupScript: fetches.local,
  fetchGitHubRepoConfigSetupScript: fetches.github,
}));

import {
  createRepoConfigProbeScheduler,
  probeIdentityKey,
  probeRepoConfigSetupScript,
  repoIdentityKey,
  type RepoConfigProbeOptions,
  type RepoConfigProbeSelectionOptions,
  type RepoIdentity,
} from './repo-config-probe';

afterEach(() => vi.clearAllMocks());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Options harness with spies and pass-through defaults. */
function makeOptions(identity: RepoIdentity, overrides: Partial<RepoConfigProbeOptions> = {}) {
  const options = {
    identity,
    preservedRestoredState: false,
    getCurrentIdentity: () => identity,
    getSetupScript: () => '',
    isSetupScriptModalOpen: () => false,
    isCustomSetupScript: () => false,
    setLoading: vi.fn(),
    onProbeResult: vi.fn(),
    applyScript: vi.fn(),
    ...overrides,
  };
  return options as RepoConfigProbeOptions & {
    setLoading: ReturnType<typeof vi.fn>;
    onProbeResult: ReturnType<typeof vi.fn>;
    applyScript: ReturnType<typeof vi.fn>;
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('repoIdentityKey', () => {
  it('uses the bare path for local repos', () => {
    expect(repoIdentityKey({ path: '/repo/a', type: 'local' })).toBe('/repo/a');
  });

  it('includes the GitHub URL so two repos sharing a clone path differ', () => {
    const a = repoIdentityKey({
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner-a/x',
    });
    const b = repoIdentityKey({
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner-b/x',
    });
    expect(a).not.toBe(b);
  });

  it('is null for a null path on non-GitHub selections', () => {
    expect(repoIdentityKey({ path: null, type: 'local' })).toBeNull();
    expect(repoIdentityKey({ path: null, type: undefined })).toBeNull();
  });

  it('ignores the branch — a branch change is not a repo change', () => {
    const identity: RepoIdentity = {
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner/x',
    };
    expect(repoIdentityKey({ ...identity, branch: 'main' })).toBe(
      repoIdentityKey({ ...identity, branch: 'release-1.x' }),
    );
  });
});

describe('probeIdentityKey', () => {
  it('includes the branch for GitHub selections so a ref change supersedes in-flight probes', () => {
    const identity: RepoIdentity = {
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner/x',
    };
    const main = probeIdentityKey({ ...identity, branch: 'main' });
    const release = probeIdentityKey({ ...identity, branch: 'release-1.x' });
    expect(main).not.toBe(release);
  });

  it('keys a cleared branch as the repo default (empty ref)', () => {
    const identity: RepoIdentity = {
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner/x',
    };
    expect(probeIdentityKey({ ...identity, branch: '' })).toBe(
      probeIdentityKey({ ...identity, branch: null }),
    );
    expect(probeIdentityKey({ ...identity, branch: '' })).not.toBe(
      probeIdentityKey({ ...identity, branch: 'main' }),
    );
  });

  it('ignores the branch for local repos (detection reads the working tree)', () => {
    expect(probeIdentityKey({ path: '/repo/a', type: 'local', branch: 'main' })).toBe(
      probeIdentityKey({ path: '/repo/a', type: 'local', branch: 'other' }),
    );
    expect(probeIdentityKey({ path: '/repo/a', type: 'local', branch: 'main' })).toBe('/repo/a');
  });
});

describe('probeRepoConfigSetupScript', () => {
  it('applies a local repo-config script and toggles the spinner', async () => {
    fetches.local.mockResolvedValue('echo repo-config');
    const options = makeOptions({ path: '/repo/a', type: 'local' });

    probeRepoConfigSetupScript(options);
    expect(options.setLoading).toHaveBeenNthCalledWith(1, false);
    expect(options.setLoading).toHaveBeenNthCalledWith(2, true);
    await flush();

    expect(fetches.local).toHaveBeenCalledWith('/repo/a');
    expect(options.setLoading).toHaveBeenLastCalledWith(false);
    expect(options.onProbeResult).toHaveBeenCalledWith('echo repo-config');
    expect(options.applyScript).toHaveBeenCalledWith('echo repo-config');
  });

  it('does not probe local paths that are not absolute', async () => {
    const options = makeOptions({ path: '~/repo/a', type: 'local' });
    probeRepoConfigSetupScript(options);
    await flush();

    expect(fetches.local).not.toHaveBeenCalled();
    expect(options.setLoading).toHaveBeenCalledTimes(1);
    expect(options.setLoading).toHaveBeenCalledWith(false);
    expect(options.onProbeResult).not.toHaveBeenCalled();
  });

  it('does not probe remote/new selections', async () => {
    const options = makeOptions({ path: '/repo/a', type: 'remote' });
    probeRepoConfigSetupScript(options);
    await flush();

    expect(fetches.local).not.toHaveBeenCalled();
    expect(fetches.github).not.toHaveBeenCalled();
  });

  it('probes GitHub selections via the URL with the identity branch as ref', async () => {
    fetches.github.mockResolvedValue('echo gh-config');
    const options = makeOptions({
      path: '/clones/repo',
      type: 'github',
      githubUrl: 'https://github.com/owner/repo',
      branch: 'release-1.x',
    });
    probeRepoConfigSetupScript(options);
    await flush();

    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    expect(options.applyScript).toHaveBeenCalledWith('echo gh-config');
  });

  it('omits ref when no branch is selected and falls back to parsing the path', async () => {
    fetches.github.mockResolvedValue(null);
    const options = makeOptions({ path: 'owner/repo', type: 'github', githubUrl: '', branch: '' });
    probeRepoConfigSetupScript(options);
    await flush();

    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', undefined);
  });

  it('caches a null result without applying anything', async () => {
    fetches.local.mockResolvedValue(null);
    const options = makeOptions({ path: '/repo/a', type: 'local' });
    probeRepoConfigSetupScript(options);
    await flush();

    expect(options.onProbeResult).toHaveBeenCalledWith(null);
    expect(options.applyScript).not.toHaveBeenCalled();
    expect(options.setLoading).toHaveBeenLastCalledWith(false);
  });

  it('drops a stale result after the repo identity changes mid-flight', async () => {
    const probe = deferred<string | null>();
    fetches.local.mockReturnValue(probe.promise);
    const options = makeOptions(
      { path: '/repo/a', type: 'local' },
      { getCurrentIdentity: () => ({ path: '/repo/b', type: 'local' }) },
    );
    probeRepoConfigSetupScript(options);
    probe.resolve('echo a-script');
    await flush();

    expect(options.onProbeResult).not.toHaveBeenCalled();
    expect(options.applyScript).not.toHaveBeenCalled();
    // Loading is left for the new repo's own probe run to manage.
    expect(options.setLoading).toHaveBeenLastCalledWith(true);
  });

  it('drops a stale GitHub result when only the URL changed (shared clone path)', async () => {
    const probe = deferred<string | null>();
    fetches.github.mockReturnValue(probe.promise);
    const options = makeOptions(
      { path: '/clones/x', type: 'github', githubUrl: 'https://github.com/owner-a/x' },
      {
        getCurrentIdentity: () => ({
          path: '/clones/x',
          type: 'github',
          githubUrl: 'https://github.com/owner-b/x',
        }),
      },
    );
    probeRepoConfigSetupScript(options);
    probe.resolve('echo a-config');
    await flush();

    expect(options.onProbeResult).not.toHaveBeenCalled();
    expect(options.applyScript).not.toHaveBeenCalled();
  });

  it('drops a stale GitHub result when the branch changed mid-flight (superseded ref)', async () => {
    const probe = deferred<string | null>();
    fetches.github.mockReturnValue(probe.promise);
    const identity: RepoIdentity = {
      path: '/clones/x',
      type: 'github',
      githubUrl: 'https://github.com/owner/x',
      branch: 'main',
    };
    const options = makeOptions(identity, {
      getCurrentIdentity: () => ({ ...identity, branch: 'release-1.x' }),
    });
    probeRepoConfigSetupScript(options);
    probe.resolve('echo main-config');
    await flush();

    expect(fetches.github).toHaveBeenCalledWith('owner', 'x', 'main');
    expect(options.onProbeResult).not.toHaveBeenCalled();
    expect(options.applyScript).not.toHaveBeenCalled();
  });

  it('caches but never applies over preserved restored form state', async () => {
    fetches.local.mockResolvedValue('echo repo-config');
    const options = makeOptions(
      { path: '/repo/a', type: 'local' },
      { preservedRestoredState: true, getSetupScript: () => 'echo restored' },
    );
    probeRepoConfigSetupScript(options);
    await flush();

    expect(options.onProbeResult).toHaveBeenCalledWith('echo repo-config');
    expect(options.applyScript).not.toHaveBeenCalled();
  });

  it('caches but never applies while the setup-script modal is open', async () => {
    fetches.local.mockResolvedValue('echo repo-config');
    const options = makeOptions(
      { path: '/repo/a', type: 'local' },
      { isSetupScriptModalOpen: () => true },
    );
    probeRepoConfigSetupScript(options);
    await flush();

    expect(options.onProbeResult).toHaveBeenCalledWith('echo repo-config');
    expect(options.applyScript).not.toHaveBeenCalled();
  });

  it('caches but never applies over a custom user script', async () => {
    fetches.local.mockResolvedValue('echo repo-config');
    const options = makeOptions(
      { path: '/repo/a', type: 'local' },
      { isCustomSetupScript: () => true },
    );
    probeRepoConfigSetupScript(options);
    await flush();

    expect(options.onProbeResult).toHaveBeenCalledWith('echo repo-config');
    expect(options.applyScript).not.toHaveBeenCalled();
  });

  it('caches but never applies when the script changed while the read was in flight', async () => {
    const probe = deferred<string | null>();
    fetches.local.mockReturnValue(probe.promise);
    let script = '';
    const options = makeOptions(
      { path: '/repo/a', type: 'local' },
      { getSetupScript: () => script },
    );
    probeRepoConfigSetupScript(options);
    script = 'echo user-edit';
    probe.resolve('echo repo-config');
    await flush();

    expect(options.onProbeResult).toHaveBeenCalledWith('echo repo-config');
    expect(options.applyScript).not.toHaveBeenCalled();
  });
});

describe('createRepoConfigProbeScheduler', () => {
  const DEBOUNCE = 300;

  /** Selection-options harness: identity is mutable so getters stay current. */
  function makeScheduler(initial: RepoIdentity) {
    const scheduler = createRepoConfigProbeScheduler(DEBOUNCE);
    const state = { identity: initial };
    const onRepoChange =
      vi.fn<(context: { isInitialMount: boolean; preservedRestoredState: boolean }) => void>();
    const spies = {
      onRepoChange,
      setLoading: vi.fn(),
      onProbeResult: vi.fn(),
      applyScript: vi.fn(),
    };
    const select = (identity: RepoIdentity, overrides: Partial<RepoConfigProbeSelectionOptions> = {}) => {
      state.identity = identity;
      scheduler.onSelectionChange({
        identity,
        getCurrentIdentity: () => state.identity,
        getSetupScript: () => '',
        isSetupScriptModalOpen: () => false,
        isCustomSetupScript: () => false,
        ...spies,
        ...overrides,
      });
    };
    return { select, spies, state, scheduler };
  }

  const ghIdentity = (branch: string | null): RepoIdentity => ({
    path: '/clones/repo',
    type: 'github',
    githubUrl: 'https://github.com/owner/repo',
    branch,
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('probes immediately on repo selection (initial mount) after running onRepoChange', async () => {
    fetches.github.mockResolvedValue('echo gh-config');
    const { select, spies } = makeScheduler(ghIdentity('main'));

    select(ghIdentity('main'));

    expect(spies.onRepoChange).toHaveBeenCalledWith({
      isInitialMount: true,
      preservedRestoredState: false,
    });
    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', 'main');
    await vi.runAllTimersAsync();
    expect(spies.applyScript).toHaveBeenCalledWith('echo gh-config');
  });

  it('re-probes with the new ref after the debounce when only the branch changes', async () => {
    fetches.github.mockResolvedValue(null);
    const { select, spies } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();

    select(ghIdentity('release-1.x'));
    // Debounced: no request yet, and no repo-change side effects.
    expect(fetches.github).not.toHaveBeenCalled();
    expect(spies.onRepoChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEBOUNCE);
    expect(fetches.github).toHaveBeenCalledTimes(1);
    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
  });

  it('coalesces rapid branch changes into a single request for the final ref', async () => {
    fetches.github.mockResolvedValue(null);
    const { select } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();

    select(ghIdentity('r'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 50);
    select(ghIdentity('rel'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE - 50);
    select(ghIdentity('release-1.x'));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(fetches.github).toHaveBeenCalledTimes(1);
    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
  });

  it('re-probes with the repo default (no ref) when the branch is cleared', async () => {
    fetches.github.mockResolvedValue(null);
    const { select } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();

    select(ghIdentity(''));
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', undefined);
  });

  it('is a no-op when nothing probe-relevant changed', async () => {
    fetches.github.mockResolvedValue(null);
    const { select, spies } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();

    select(ghIdentity('main'));
    await vi.runAllTimersAsync();

    expect(fetches.github).not.toHaveBeenCalled();
    expect(spies.onRepoChange).toHaveBeenCalledTimes(1);
  });

  it('dispose() cancels a pending branch re-probe (component destroy)', async () => {
    fetches.github.mockResolvedValue(null);
    const { select, spies, scheduler } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();
    spies.setLoading.mockClear();
    spies.onProbeResult.mockClear();

    select(ghIdentity('release-1.x'));
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(DEBOUNCE);

    // No RPC and no writes to (destroyed) component state.
    expect(fetches.github).not.toHaveBeenCalled();
    expect(spies.setLoading).not.toHaveBeenCalled();
    expect(spies.onProbeResult).not.toHaveBeenCalled();
    expect(spies.applyScript).not.toHaveBeenCalled();
  });

  it('dispose() prevents any further scheduling', async () => {
    fetches.github.mockResolvedValue(null);
    const { select, spies, scheduler } = makeScheduler(ghIdentity('main'));
    scheduler.dispose();

    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    select(ghIdentity('release-1.x'));
    await vi.runAllTimersAsync();

    expect(spies.onRepoChange).not.toHaveBeenCalled();
    expect(fetches.github).not.toHaveBeenCalled();
    expect(spies.setLoading).not.toHaveBeenCalled();
  });

  it('cancels a pending branch re-probe when the repo changes', async () => {
    fetches.github.mockResolvedValue(null);
    const { select, spies } = makeScheduler(ghIdentity('main'));
    select(ghIdentity('main'));
    await vi.runAllTimersAsync();
    fetches.github.mockClear();

    select(ghIdentity('release-1.x'));
    const other: RepoIdentity = {
      path: '/clones/repo',
      type: 'github',
      githubUrl: 'https://github.com/other/repo',
      branch: 'release-1.x',
    };
    select(other);
    expect(spies.onRepoChange).toHaveBeenLastCalledWith({
      isInitialMount: false,
      preservedRestoredState: false,
    });
    await vi.runAllTimersAsync();

    // Only the new repo's immediate probe fires — never the superseded ref's.
    expect(fetches.github).toHaveBeenCalledTimes(1);
    expect(fetches.github).toHaveBeenCalledWith('other', 'repo', 'release-1.x');
  });

  it('does not re-probe local repos on branch changes', async () => {
    fetches.local.mockResolvedValue(null);
    const local = (branch: string): RepoIdentity => ({ path: '/repo/a', type: 'local', branch });
    const { select } = makeScheduler(local('main'));
    select(local('main'));
    await vi.runAllTimersAsync();
    expect(fetches.local).toHaveBeenCalledTimes(1);

    select(local('other'));
    await vi.runAllTimersAsync();
    expect(fetches.local).toHaveBeenCalledTimes(1);
  });

  it('keeps honoring restored form state on branch-only re-probes', async () => {
    fetches.github.mockResolvedValue('echo gh-config');
    const { select, spies } = makeScheduler(ghIdentity('main'));
    // Initial mount with a restored non-empty setup script.
    select(ghIdentity('main'), { getSetupScript: () => 'echo restored' });
    expect(spies.onRepoChange).toHaveBeenCalledWith({
      isInitialMount: true,
      preservedRestoredState: true,
    });
    await vi.runAllTimersAsync();
    expect(spies.applyScript).not.toHaveBeenCalled();

    select(ghIdentity('release-1.x'), { getSetupScript: () => 'echo restored' });
    await vi.runAllTimersAsync();

    // Re-probed with the new ref, cached, but restored state still wins.
    expect(fetches.github).toHaveBeenLastCalledWith('owner', 'repo', 'release-1.x');
    expect(spies.onProbeResult).toHaveBeenCalledWith('echo gh-config');
    expect(spies.applyScript).not.toHaveBeenCalled();
  });
});
