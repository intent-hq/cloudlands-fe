/**
 * Tests for the shared repo-config detection probe (monorepo#833): the
 * repo-identity staleness key, local/GitHub probe routing, spinner state,
 * and the no-clobber guards (restored form state, user edits, open
 * setup-script modal, stale results after a repo switch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  probeRepoConfigSetupScript,
  repoIdentityKey,
  type RepoConfigProbeOptions,
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
    getBranch: () => 'main',
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

  it('probes GitHub selections via the URL with the branch as ref', async () => {
    fetches.github.mockResolvedValue('echo gh-config');
    const options = makeOptions(
      { path: '/clones/repo', type: 'github', githubUrl: 'https://github.com/owner/repo' },
      { getBranch: () => 'release-1.x' },
    );
    probeRepoConfigSetupScript(options);
    await flush();

    expect(fetches.github).toHaveBeenCalledWith('owner', 'repo', 'release-1.x');
    expect(options.applyScript).toHaveBeenCalledWith('echo gh-config');
  });

  it('omits ref when no branch is selected and falls back to parsing the path', async () => {
    fetches.github.mockResolvedValue(null);
    const options = makeOptions(
      { path: 'owner/repo', type: 'github', githubUrl: '' },
      { getBranch: () => '' },
    );
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
