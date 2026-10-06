import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, getItems } from '@themislib/themis/utils/collections/collection-utils';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import {
  admitLegacyPrincipal,
  withHostPrincipal,
} from '../../../../../test/fixtures/principal-state';
import { principalContextChanged, principalReceived } from '../../principal/principal-slice';
import {
  setLabsGitLabEnabled,
  setLabsMultiplayerEnabled,
} from '../../user-preferences/user-preferences-slice';
import { gitlabAuthChanged } from '../../gitlab-auth/gitlab-auth-slice';
import {
  opened,
  checkoutRepoConfigRequested,
  closed,
  projectSelected,
  projectQueryChanged,
  urlSubmitted,
  projectsMoreRequested,
  branchQueryChanged,
  branchesMoreRequested,
  branchSelected,
  modeChanged,
} from '../repository-checkout-slice';
import { selectCheckoutSelection, selectCheckoutCanCreate } from '../repository-checkout-selectors';
import { repositoryCheckoutSaga } from './repository-checkout-saga';
import type {
  CheckoutCapture,
  CheckoutProject,
  CheckoutResult,
  RepositoryCheckoutSession,
} from '$shared/types/repository-checkout';

const capture: CheckoutCapture = {
  checkoutId: 'lease-A',
  revision: 'auth-A',
  provider: 'gitlab',
  instanceBaseUrl: 'https://forge.example:8443/Forge',
  expiresAfterMs: 300000,
};
const project = (projectPath: string): CheckoutProject => ({
  projectPath,
  name: projectPath.split('/').at(-1)!,
  namespace: projectPath.slice(0, projectPath.lastIndexOf('/')),
  webUrl: capture.instanceBaseUrl + '/' + projectPath,
  cloneUrl: capture.instanceBaseUrl + '/' + projectPath + '.git',
  defaultBranch: 'trunk',
});
const branch = (name: string) => ({
  name,
  commitSha: name === 'trunk' ? 'a'.repeat(40) : 'b'.repeat(40),
});
const ready = <T>(value: T): CheckoutResult<T> => ({ status: 'ready', value });
const form = () => getItem(store.state.repositoryCheckout.forms, 'form')!;
const scope = () => form().scopeKey!;
const advance = () => vi.advanceTimersByTimeAsync(250);
const sessions: ReturnType<typeof session>[] = [];
function session() {
  const listeners = new Set<() => void>();
  const result = {
    capture,
    repoConfig: undefined as RepositoryCheckoutSession['repoConfig'],
    onRetired: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    projects: vi
      .fn<RepositoryCheckoutSession['projects']>()
      .mockResolvedValue(ready({ items: [] })),
    project: vi
      .fn<RepositoryCheckoutSession['project']>()
      .mockImplementation(async (query) =>
        ready({ project: project('projectPath' in query ? query.projectPath : 'group/target') }),
      ),
    branches: vi
      .fn<RepositoryCheckoutSession['branches']>()
      .mockImplementation(async (query) =>
        ready({ items: [branch(query.query || 'trunk')], cached: true }),
      ),
    warm: vi.fn<RepositoryCheckoutSession['warm']>().mockImplementation(async (selection) =>
      ready({
        projectPath: selection.projectPath,
        branch: selection.branch,
        commitSha: selection.commitSha,
        cached: true,
      }),
    ),
    release: vi.fn<RepositoryCheckoutSession['release']>().mockImplementation(async () => {
      for (const listener of [...listeners]) listener();
      listeners.clear();
    }),
  };
  return result;
}
let dispose: () => void, stop: () => void;
let captureSpy: ReturnType<
  typeof vi.spyOn<typeof appClient.integrations, 'captureRepositoryCheckout'>
>;
function admit(role: 'owner' | 'member' | 'guest' = 'owner') {
  admitLegacyPrincipal();
  const { principal } = withHostPrincipal(store.state, role);
  store.dispatch(principalContextChanged(principal.context));
  store.dispatch(
    principalReceived(
      {
        context: principal.context!,
        invalidation: store.state.principal.invalidation,
        presentationVersion: store.state.principal.presentationVersion,
      },
      principal.snapshot!,
    ),
  );
}
beforeAll(() => {
  dispose = store.init();
});
afterAll(() => dispose());
beforeEach(() => {
  vi.useFakeTimers();
  store.dispatch(setLabsGitLabEnabled(true));
  store.dispatch(setLabsMultiplayerEnabled(true));
  admit();
  captureSpy = vi
    .spyOn(appClient.integrations, 'captureRepositoryCheckout')
    .mockImplementation(async () => {
      const s = session();
      sessions.push(s);
      return ready(s);
    });
  stop = store.runSaga(repositoryCheckoutSaga);
});
afterEach(() => {
  store.dispatch(closed('form'));
  stop();
  captureSpy.mockRestore();
  sessions.length = 0;
  vi.useRealTimers();
});
async function open() {
  store.dispatch(opened('form'));
  await advance();
  return sessions.at(-1)!;
}

describe('qualified project and branch selection in the real renderer store', () => {
  it('keeps config reads on the existing session and rejects a result after project replacement', async () => {
    const s = await open();
    store.dispatch(projectSelected('form', scope(), 'group/target'));
    await advance();
    const selected = selectCheckoutSelection.select(store.state, 'form')!;
    const { mode: _mode, ...query } = selected;
    const held =
      Promise.withResolvers<
        Awaited<ReturnType<NonNullable<RepositoryCheckoutSession['repoConfig']>>>
      >();
    s.repoConfig = vi.fn().mockReturnValue(held.promise);
    const action = checkoutRepoConfigRequested('form', scope(), query);
    store.dispatch(action);
    expect(s.repoConfig).toHaveBeenCalledExactlyOnceWith(query);
    store.dispatch(projectSelected('form', scope(), 'group/other'));
    held.resolve(
      ready({
        projectPath: query.projectPath,
        branch: query.branch,
        commitSha: query.commitSha,
        config: { setupScript: 'echo old' },
        exists: true,
      }),
    );
    await advance();
    await expect(action.promise).resolves.toEqual({ status: 'unavailable', reason: 'retired' });
    expect(captureSpy).toHaveBeenCalledOnce();
  });

  it('reports missing config capability without acquiring a replacement session', async () => {
    await open();
    store.dispatch(projectSelected('form', scope(), 'group/target'));
    await advance();
    const { mode: _mode, ...query } = selectCheckoutSelection.select(store.state, 'form')!;
    const action = checkoutRepoConfigRequested('form', scope(), query);
    store.dispatch(action);
    await expect(action.promise).resolves.toEqual({ status: 'unsupported' });
    expect(captureSpy).toHaveBeenCalledOnce();
  });

  it('clears default loading when branch pagination invalidates the pending lookup', async () => {
    const s = await open();
    const automatic =
      Promise.withResolvers<
        CheckoutResult<{ items: ReturnType<typeof branch>[]; cached: boolean }>
      >();
    s.branches.mockImplementation(async (query) => {
      if (query.query === 'trunk') return automatic.promise;
      return query.cursor
        ? ready({ items: [branch('release/page-two')], cached: true })
        : ready({ items: [branch('release/next')], nextCursor: 'page-2', cached: true });
    });
    store.dispatch(projectSelected('form', scope(), 'group/target'));
    await advance();
    expect(form().branchesStatus).toBe('ready');
    expect(form().resolvingBranch).toBe(true);
    const originalRevision = form().branchesRevision;
    store.dispatch(branchesMoreRequested('form', scope()));
    await advance();
    expect(form().branchesRevision).toBeGreaterThan(originalRevision);
    expect(form().branchesStatus).toBe('ready');
    expect(getItems(form().branches).map((b) => b.name)).toContain('release/page-two');
    automatic.resolve(ready({ items: [], cached: true }));
    await advance();
    expect(form().branch).toBeNull();
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(false);
    expect(form().resolvingBranch).toBe(false);
  });

  it('keeps default resolution visibly loading after the branch list arrives, then exposes a missing default', async () => {
    const s = await open();
    const automatic =
      Promise.withResolvers<
        CheckoutResult<{ items: ReturnType<typeof branch>[]; cached: boolean }>
      >();
    s.branches.mockImplementation(async (query) =>
      query.query === 'trunk'
        ? automatic.promise
        : ready({ items: [branch('release/next')], cached: true }),
    );
    store.dispatch(projectSelected('form', scope(), 'group/target'));
    await advance();
    expect(form().branchesStatus).toBe('ready');
    expect(form().resolvingBranch).toBe(true);
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(false);
    automatic.resolve(ready({ items: [], cached: true }));
    await advance();
    expect(form().resolvingBranch).toBe(false);
    expect(form().branch).toBeNull();
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(false);
  });

  it('enables cached creation only after the real default resolves and warming completes', async () => {
    const s = await open();
    let finishWarm!: (value: Awaited<ReturnType<RepositoryCheckoutSession['warm']>>) => void;
    s.warm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWarm = resolve;
        }),
    );
    store.dispatch(projectSelected('form', scope(), 'group/target'));
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(false);
    await advance();
    expect(s.branches).toHaveBeenCalledWith({
      projectPath: 'group/target',
      query: 'trunk',
      limit: 50,
      cached: true,
    });
    expect(form().branch).toEqual(branch('trunk'));
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(false);
    finishWarm(
      ready({
        projectPath: 'group/target',
        branch: 'trunk',
        commitSha: 'a'.repeat(40),
        cached: true,
      }),
    );
    await advance();
    expect(selectCheckoutCanCreate.select(store.state, 'form')).toBe(true);
    expect(selectCheckoutSelection.select(store.state, 'form')).toEqual({
      checkoutId: capture.checkoutId,
      revision: capture.revision,
      projectPath: 'group/target',
      branch: 'trunk',
      commitSha: 'a'.repeat(40),
      mode: 'cached',
    });
  });

  it('waits for explicit URL submission and preserves its original context spelling', async () => {
    const s = await open();
    s.projects.mockClear();
    const url = `${capture.instanceBaseUrl}/nested/group/target/-/merge_requests/7/diffs?view=parallel#note_4`;
    for (const value of [capture.instanceBaseUrl + '/', url]) {
      store.dispatch(projectQueryChanged('form', scope(), value));
      await advance();
    }
    expect(s.projects).not.toHaveBeenCalled();
    expect(s.project).not.toHaveBeenCalled();
    expect(form().projectsStatus).toBe('ready');
    s.project.mockResolvedValueOnce(
      ready({ project: project('nested/group/target'), contextUrl: url }),
    );
    store.dispatch(urlSubmitted('form', scope(), url));
    await advance();
    expect(s.project).toHaveBeenCalledExactlyOnceWith({ url });
    expect(form().contextUrl).toBe(url);
    expect(form().branch?.name).toBe('trunk');
  });
  it('resolves the default in the new mode when an earlier default search is pending', async () => {
    const s = await open();
    const oldDefault =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['branches']>>>();
    s.branches.mockImplementation(async (q) =>
      q.query === 'trunk' && q.cached
        ? oldDefault.promise
        : ready({ items: [branch('trunk')], cached: false }),
    );
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    expect(form().branch).toBeNull();
    store.dispatch(modeChanged('form', scope(), 'direct'));
    await advance();
    expect(form().branch?.name).toBe('trunk');
    expect(selectCheckoutSelection.select(store.state, 'form')?.mode).toBe('direct');
    oldDefault.resolve(
      ready({ items: [{ name: 'trunk', commitSha: 'f'.repeat(40) }], cached: true }),
    );
    await advance();
    expect(form().branch?.commitSha).toBe('a'.repeat(40));
    expect(s.warm).not.toHaveBeenCalled();
  });
  it('starts a new branch page when the cache lane changes and ignores the old cursor', async () => {
    const s = await open();
    const oldPage =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['branches']>>>();
    s.branches.mockImplementation(async (q) => {
      if (q.cursor === 'cached/page-2') return oldPage.promise;
      return ready({
        items: [branch('trunk')],
        nextCursor: q.cached ? 'cached/page-2' : 'direct/page-2',
        cached: q.cached === true,
      });
    });
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    store.dispatch(branchesMoreRequested('form', scope()));
    await advance();
    store.dispatch(modeChanged('form', scope(), 'direct'));
    await advance();
    expect(s.branches).toHaveBeenCalledWith({ projectPath: 'group/A', limit: 50, cached: false });
    expect(form().branchesCursor).toBe('direct/page-2');
    oldPage.resolve(
      ready({ items: [branch('stale/cached')], nextCursor: 'cached/page-3', cached: true }),
    );
    await advance();
    expect(form().branchesCursor).toBe('direct/page-2');
    expect(getItems(form().branches).map((b) => b.name)).toEqual(['trunk']);
    expect(selectCheckoutSelection.select(store.state, 'form')?.mode).toBe('direct');
  });
  it('does not let an old warm failure retire a newer selected project', async () => {
    const s = await open();
    const oldWarm = Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['warm']>>>();
    s.warm.mockReturnValueOnce(oldWarm.promise);
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    store.dispatch(projectSelected('form', scope(), 'group/B'));
    await advance();
    oldWarm.resolve({ status: 'unavailable', reason: 'branch-changed' });
    await advance();
    expect(form().status).toBe('ready');
    expect(form().project?.projectPath).toBe('group/B');
    expect(form().warmStatus).toBe('ready');
  });
  it('retains known denial from an older request before accepting a newer private result', async () => {
    const s = await open();
    const denied =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['projects']>>>();
    s.projects.mockReturnValueOnce(denied.promise);
    store.dispatch(projectQueryChanged('form', scope(), 'old'));
    await advance();
    s.projects.mockResolvedValueOnce(ready({ items: [project('private/current')] }));
    store.dispatch(projectQueryChanged('form', scope(), 'current'));
    await advance();
    denied.resolve({ status: 'unavailable', reason: 'access-denied' });
    await advance();
    expect(form().unavailable?.reason).toBe('access-denied');
    expect(getItems(form().projects)).toEqual([]);
    expect(s.release).toHaveBeenCalled();
  });
  it.each(['owner', 'member'] as const)(
    'admits pre-workspace %s without an invented workspace id',
    async (role) => {
      admit(role);
      await open();
      expect(captureSpy).toHaveBeenCalledExactlyOnceWith({ provider: 'gitlab' });
      expect(form().status).toBe('ready');
    },
  );
  it('makes no capture for a guest or disabled Labs feature', async () => {
    admit('guest');
    store.dispatch(opened('form'));
    await advance();
    expect(captureSpy).not.toHaveBeenCalled();
    admit();
    store.dispatch(setLabsGitLabEnabled(false));
    store.dispatch(opened('form'));
    await advance();
    expect(captureSpy).not.toHaveBeenCalled();
    expect(form().status).toBe('unavailable');
  });
  it('selects a nondefault branch beyond page one and restores it only for the same project', async () => {
    const s = await open();
    s.branches.mockImplementation(async (q) =>
      ready(
        q.query
          ? { items: [branch(q.query)], cached: true }
          : q.cursor
            ? { items: [branch('release/next')], cached: true }
            : { items: [branch('trunk')], nextCursor: 'project-A/page-2', cached: true },
      ),
    );
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    store.dispatch(branchesMoreRequested('form', scope()));
    await advance();
    expect(s.branches).toHaveBeenCalledWith({
      projectPath: 'group/A',
      cursor: 'project-A/page-2',
      limit: 50,
      cached: true,
    });
    store.dispatch(branchSelected('form', scope(), branch('release/next')));
    await advance();
    expect(selectCheckoutSelection.select(store.state, 'form')).toMatchObject({
      projectPath: 'group/A',
      branch: 'release/next',
      commitSha: 'b'.repeat(40),
    });
    store.dispatch(projectSelected('form', scope(), 'group/B'));
    await advance();
    expect(form().branch?.name).toBe('trunk');
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    expect(form().branch?.name).toBe('release/next');
    expect(s.branches).toHaveBeenCalledWith({
      projectPath: 'group/A',
      query: 'release/next',
      limit: 50,
      cached: true,
    });
  });
  it('keeps project and branch cursors separate and does not issue duplicate next-page requests', async () => {
    const s = await open();
    const pending =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['projects']>>>();
    s.projects
      .mockResolvedValueOnce(ready({ items: [project('group/A')], nextCursor: 'projects/page-2' }))
      .mockReturnValueOnce(pending.promise);
    store.dispatch(projectQueryChanged('form', scope(), 'group'));
    await advance();
    store.dispatch(projectsMoreRequested('form', scope()));
    store.dispatch(projectsMoreRequested('form', scope()));
    await advance();
    expect(s.projects.mock.calls.filter(([q]) => q.cursor === 'projects/page-2')).toHaveLength(1);
    store.dispatch(projectQueryChanged('form', scope(), 'other'));
    await advance();
    pending.resolve(ready({ items: [project('private/stale')] }));
    await advance();
    expect(getItems(form().projects).some((p) => p.projectPath === 'private/stale')).toBe(false);
    expect(form().projectsCursor).toBeNull();
  });
  it('does not apply an older branch query or automatic default over an explicit choice', async () => {
    const s = await open();
    const automatic =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['branches']>>>();
    s.branches.mockImplementation(async (q) =>
      q.query === 'trunk'
        ? automatic.promise
        : ready({ items: [branch('release/next')], cached: true }),
    );
    store.dispatch(projectSelected('form', scope(), 'group/A'));
    await advance();
    store.dispatch(branchSelected('form', scope(), branch('release/next')));
    await advance();
    automatic.resolve(ready({ items: [branch('trunk')], cached: true }));
    await advance();
    expect(form().branch?.name).toBe('release/next');
    const stale =
      Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['branches']>>>();
    s.branches.mockReturnValueOnce(stale.promise);
    store.dispatch(branchQueryChanged('form', scope(), 'old'));
    await advance();
    store.dispatch(branchQueryChanged('form', scope(), 'new'));
    await advance();
    stale.resolve(ready({ items: [branch('old')], nextCursor: 'old/page-2', cached: true }));
    await advance();
    expect(getItems(form().branches)).toEqual([branch('release/next')]);
    expect(form().branchesCursor).toBeNull();
  });
  it('resolves a saved name across search pages and never trusts a saved commit or invented default', async () => {
    const s = session();
    s.branches.mockImplementation(async (q) =>
      ready(
        !q.query
          ? { items: [], cached: true }
          : q.cursor
            ? { items: [branch('feature/saved')], cached: true }
            : { items: [branch('feature/saved-prefix')], nextCursor: 'exact/page-2', cached: true },
      ),
    );
    captureSpy.mockResolvedValueOnce(ready(s));
    store.dispatch(
      opened('form', {
        instanceBaseUrl: capture.instanceBaseUrl,
        projectPath: 'nested/group/repo',
        branch: 'feature/saved',
      }),
    );
    await advance();
    expect(form().branch?.name).toBe('feature/saved');
    expect(captureSpy).toHaveBeenCalledWith({
      provider: 'gitlab',
      instanceBaseUrl: capture.instanceBaseUrl,
    });
    s.project.mockResolvedValueOnce(
      ready({ project: { ...project('empty/repo'), defaultBranch: undefined } }),
    );
    s.branches.mockResolvedValue(ready({ items: [], cached: false }));
    store.dispatch(projectSelected('form', scope(), 'empty/repo'));
    await advance();
    expect(selectCheckoutSelection.select(store.state, 'form')).toBeNull();
  });
  it('releases late acquisition on close and never installs it in a replacement form', async () => {
    const late = Promise.withResolvers<CheckoutResult<RepositoryCheckoutSession>>();
    const a = session();
    captureSpy.mockReturnValueOnce(late.promise);
    store.dispatch(opened('form'));
    await advance();
    store.dispatch(closed('form'));
    await open();
    const replacement = scope();
    late.resolve(ready(a));
    await advance();
    expect(a.release).toHaveBeenCalled();
    expect(scope()).toBe(replacement);
  });
  it('clears private rows and late warm results on account retirement before fresh denial or recovery', async () => {
    const a = await open();
    const warming = Promise.withResolvers<Awaited<ReturnType<RepositoryCheckoutSession['warm']>>>();
    a.warm.mockReturnValueOnce(warming.promise);
    store.dispatch(projectSelected('form', scope(), 'private/A'));
    await advance();
    expect(form().warmStatus).toBe('warming');
    store.dispatch(gitlabAuthChanged('revoked', 'forge.example:8443'));
    await advance();
    warming.resolve(
      ready({ projectPath: 'private/A', branch: 'trunk', commitSha: 'a'.repeat(40), cached: true }),
    );
    await advance();
    expect(form().status).toBe('unavailable');
    expect(form().project).toBeNull();
    expect(a.release).toHaveBeenCalled();
    captureSpy.mockResolvedValueOnce({ status: 'unavailable', reason: 'access-denied' });
    store.dispatch(
      opened('form', { instanceBaseUrl: capture.instanceBaseUrl, projectPath: 'private/A' }),
    );
    await advance();
    expect(form().unavailable?.reason).toBe('access-denied');
    store.dispatch(gitlabAuthChanged('authorized', 'forge.example:8443'));
    store.dispatch(
      opened('form', { instanceBaseUrl: capture.instanceBaseUrl, projectPath: 'private/A' }),
    );
    await advance();
    expect(form().project?.projectPath).toBe('private/A');
  });
});
