import type { PullRequestInfo, Workspace, WorkspaceId } from '$shared/types';
import { PullRequestStatus, WorkspaceStatusEnum } from '$shared/types';
import { describe, expect, it } from 'vitest';
import { openTerminalOverlay, toggleTerminalOverlay } from '../terminals/terminals-slice';
import { workspaceDeleted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  createCollection,
  getItem,
  getItems,
} from '@augmentcode/themis/utils/collections/collection-utils';
import {
  beginWorkspaceTitleMutation,
  bulkUpdateWorkspaceEntities,
  completeWorkspaceTitleMutation,
  failWorkspaceTitleMutation,
  cleanupRecency,
  clearPendingCreation,
  clearWorkspacePendingDeletion,
  initialState,
  markWorkspacePendingDeletion,
  loadRecencyData,
  replaceWorkspaceList,
  recordWorkspaceView,
  resetWorkspaceState,
  removeWorkspaceEntity,
  setPendingCreation,
  setWorkspaceCreating,
  setWorkspaceEntity,
  setWorkspaceError,
  setWorkspaceHasLoaded,
  setWorkspaceLoading,
  updateWorkspaceEntity,
  workspaceReducer,
} from './workspace-slice';
import {
  selectWorkspacesSortedByRecency,
  selectWorkspaceById,
  selectWorkspaceHasLoaded,
  selectWorkspaceIsCreating,
  selectWorkspaceIsEmpty,
  selectWorkspaceItems,
  selectWorkspaceLoading,
  selectWorkspacePendingCreations,
  selectWorkspacePendingDeletions,
} from './workspace-selectors';

/** Minimal workspace fixture for testing. */
function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

/** Minimal pull request fixture for testing. */
function makePullRequest(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    id: 'pr-1',
    number: 42,
    url: 'https://github.com/example/repo/pull/42',
    title: 'Example PR',
    status: PullRequestStatus.Open,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('workspaceReducer', () => {
  it('returns the initial state', () => {
    expect(workspaceReducer(undefined, { type: '@@INIT' })).toEqual(initialState);
  });

  describe('workspace recency tracking', () => {
    it('loads persisted recency data', () => {
      const recency = { lastViewedAt: { 'ws-1': 100, 'ws-2': 200 } };
      const next = workspaceReducer(initialState, loadRecencyData(recency));
      expect(next.recency).toEqual(recency);
    });

    it('records the last viewed timestamp for a workspace', () => {
      const next = workspaceReducer(initialState, recordWorkspaceView('ws-1', 123));
      expect(next.recency.lastViewedAt).toEqual({ 'ws-1': 123 });
    });

    it('cleans up recency data for workspaces that no longer exist', () => {
      const withRecency = workspaceReducer(
        initialState,
        loadRecencyData({ lastViewedAt: { 'ws-1': 100, 'ws-2': 200 } }),
      );

      const next = workspaceReducer(withRecency, cleanupRecency(['ws-2']));
      expect(next.recency.lastViewedAt).toEqual({ 'ws-2': 200 });
    });

    it('is a no-op when recency cleanup removes nothing', () => {
      const withRecency = workspaceReducer(
        initialState,
        loadRecencyData({ lastViewedAt: { 'ws-1': 100 } }),
      );

      const next = workspaceReducer(withRecency, cleanupRecency(['ws-1', 'ws-2']));
      expect(next).toBe(withRecency);
    });
  });

  it('does not store terminal overlay workspace state', () => {
    expect(workspaceReducer(initialState, openTerminalOverlay('ws-2'))).toBe(initialState);
    expect(workspaceReducer(initialState, toggleTerminalOverlay('ws-3'))).toBe(initialState);
  });

  describe('workspace request state', () => {
    it('tracks loading, error, loaded, and creating flags', () => {
      let state = workspaceReducer(initialState, setWorkspaceLoading(true));
      state = workspaceReducer(state, setWorkspaceError('boom'));
      state = workspaceReducer(state, setWorkspaceHasLoaded(true));
      state = workspaceReducer(state, setWorkspaceCreating(true));

      expect(state.loading).toBe(true);
      expect(state.error).toBe('boom');
      expect(state.hasLoaded).toBe(true);
      expect(state.isCreating).toBe(true);
    });

    it('stamps and preserves the loaded backend id', () => {
      let state = workspaceReducer(initialState, setWorkspaceHasLoaded(true, 'remote-1'));
      expect(state.hasLoaded).toBe(true);
      expect(state.loadedBackendId).toBe('remote-1');

      // Omitting the backend id keeps the previous stamp.
      state = workspaceReducer(state, setWorkspaceHasLoaded(true));
      expect(state.loadedBackendId).toBe('remote-1');

      // A later load for another backend replaces it.
      state = workspaceReducer(state, setWorkspaceHasLoaded(true, 'local'));
      expect(state.loadedBackendId).toBe('local');
    });

    it('tracks and clears pending deletion maps', () => {
      let state = workspaceReducer(initialState, markWorkspacePendingDeletion('ws-1'));
      expect(state.pendingDeletions).toEqual({ 'ws-1': true });

      state = workspaceReducer(state, clearWorkspacePendingDeletion('ws-1'));
      expect(state.pendingDeletions).toEqual({});
    });

    it('tracks and clears pending creations', () => {
      const pending = makeWorkspace({ id: 'pending-1', title: 'Pending' });
      let state = workspaceReducer(initialState, setPendingCreation(pending));
      expect(state.pendingCreations['pending-1']).toEqual(pending);

      state = workspaceReducer(state, clearPendingCreation('pending-1'));
      expect(state.pendingCreations).toEqual({});
    });

    it('replaces visible workspace items while preserving enrichment and pending creations', () => {
      const existing = makeWorkspace({
        id: 'ws-1',
        title: 'Existing',
        agentSummary: { agentIds: ['agent-1'] },
      });
      const pending = makeWorkspace({ id: 'pending-1', title: 'Pending' });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(state, setPendingCreation(pending));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([
          {
            ...existing,
            agentSummary: undefined,
            status: WorkspaceStatusEnum.Active,
            archived: false,
          },
          makeWorkspace({ id: 'pending-1', title: 'Pending From Backend' }),
          makeWorkspace({ id: 'ws-2', title: 'Second' }),
        ]),
      );

      expect(state.workspaces.ids).toEqual(['ws-1', 'pending-1', 'ws-2']);
      expect(getItem(state.workspaces, 'ws-1')?.agentSummary).toEqual(existing.agentSummary);
      expect(state.pendingCreations).toEqual({});
    });

    it('preserves runtime PR fields when a lite list payload omits them', () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({
        id: 'ws-1',
        title: 'Existing',
        pullRequests: [pr],
        activePullRequest: pr,
        prNumber: pr.number,
        prStatus: pr.status,
        prUrl: pr.url,
      });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([
          makeWorkspace({
            id: 'ws-1',
            title: 'Existing',
            pullRequests: undefined,
            activePullRequest: undefined,
            prNumber: undefined,
            prStatus: undefined,
            prUrl: undefined,
          }),
        ]),
      );

      const merged = getItem(state.workspaces, 'ws-1');
      expect(merged?.pullRequests).toEqual([pr]);
      expect(merged?.activePullRequest).toEqual(pr);
      expect(merged?.prNumber).toBe(pr.number);
      expect(merged?.prStatus).toBe(pr.status);
      expect(merged?.prUrl).toBe(pr.url);
    });

    it('preserves existing pullRequests when an incoming empty array would clear them', () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({ id: 'ws-1', pullRequests: [pr] });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([makeWorkspace({ id: 'ws-1', pullRequests: [] })]),
      );

      expect(getItem(state.workspaces, 'ws-1')?.pullRequests).toEqual([pr]);
    });

    it('hides rows carrying pendingDeleteAt from the list', () => {
      const existing = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        replaceWorkspaceList([
          makeWorkspace({ id: 'ws-1', pendingDeleteAt: '2026-08-11T00:00:15.000Z' }),
          makeWorkspace({ id: 'ws-2' }),
        ]),
      );

      expect(state.workspaces.ids).toEqual(['ws-2']);
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
    });

    it('resets workspace migration state including recency', () => {
      const ws = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, setWorkspaceLoading(true));
      state = workspaceReducer(state, markWorkspacePendingDeletion('ws-1'));
      state = workspaceReducer(state, recordWorkspaceView('ws-1', 123));

      const reset = workspaceReducer(state, resetWorkspaceState());
      expect(reset.workspaces).toEqual(createCollection('id'));
      expect(reset.loading).toBe(false);
      expect(reset.pendingDeletions).toEqual({});
      expect(reset.recency).toEqual(initialState.recency);
    });
  });

  // -----------------------------------------------------------------------
  // Workspace entity storage
  // -----------------------------------------------------------------------

  describe('setWorkspaceEntity', () => {
    it('stores a workspace entity by ID', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'My Workspace' });
      const next = workspaceReducer(initialState, setWorkspaceEntity(ws));
      expect(getItem(next.workspaces, 'ws-1')).toEqual(ws);
    });

    it('overwrites an existing workspace entity', () => {
      const ws1 = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const ws1Updated = makeWorkspace({ id: 'ws-1', title: 'Updated' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws1Updated));
      expect(getItem(state.workspaces, 'ws-1')?.title).toBe('Updated');
    });

    it('does not affect other workspace entities', () => {
      const ws1 = makeWorkspace({ id: 'ws-1' });
      const ws2 = makeWorkspace({ id: 'ws-2' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      expect(getItem(state.workspaces, 'ws-1')).toEqual(ws1);
      expect(getItem(state.workspaces, 'ws-2')).toEqual(ws2);
    });

    it('drops an entity carrying pendingDeleteAt instead of storing it', () => {
      const ws = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(
        state,
        setWorkspaceEntity(
          makeWorkspace({ id: 'ws-1', pendingDeleteAt: '2026-08-11T00:00:15.000Z' }),
        ),
      );
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();

      const next = workspaceReducer(
        state,
        setWorkspaceEntity(
          makeWorkspace({ id: 'ws-3', pendingDeleteAt: '2026-08-11T00:00:15.000Z' }),
        ),
      );
      expect(next).toBe(state);
    });

    it('preserves runtime PR fields when re-hydrated with a lite payload that omits them', () => {
      const pr = makePullRequest();
      const existing = makeWorkspace({
        id: 'ws-1',
        pullRequests: [pr],
        activePullRequest: pr,
        prNumber: pr.number,
        prStatus: pr.status,
        prUrl: pr.url,
      });

      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));
      state = workspaceReducer(
        state,
        setWorkspaceEntity(
          makeWorkspace({
            id: 'ws-1',
            pullRequests: undefined,
            activePullRequest: undefined,
            prNumber: undefined,
            prStatus: undefined,
            prUrl: undefined,
          }),
        ),
      );

      const merged = getItem(state.workspaces, 'ws-1');
      expect(merged?.pullRequests).toEqual([pr]);
      expect(merged?.activePullRequest).toEqual(pr);
      expect(merged?.prNumber).toBe(pr.number);
      expect(merged?.prStatus).toBe(pr.status);
      expect(merged?.prUrl).toBe(pr.url);
    });

    it('URL-unions pullRequests on entity upserts so merged-pool entries survive (monorepo#2951)', () => {
      // The entity holds the daemon-MERGED pool from a workspace.list emit:
      // the stored PR plus a git-root PR only workspace.list folds in.
      const storedPr = makePullRequest({
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
      });
      const gitRootPr = makePullRequest({
        id: 'pr-7',
        number: 7,
        url: 'https://github.com/acme/submodule/pull/7',
      });
      const existing = makeWorkspace({ id: 'ws-1', pullRequests: [storedPr, gitRootPr] });
      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));

      // A workspace.get / delta upsert carries the narrower STORED list
      // (§6.9) with a fresher status for the stored entry.
      const refreshedStoredPr = { ...storedPr, status: PullRequestStatus.Merged };
      state = workspaceReducer(
        state,
        setWorkspaceEntity(makeWorkspace({ id: 'ws-1', pullRequests: [refreshedStoredPr] })),
      );

      // Incoming wins for the matching URL; the git-root entry survives.
      expect(getItem(state.workspaces, 'ws-1')?.pullRequests).toEqual([
        refreshedStoredPr,
        gitRootPr,
      ]);
    });

    it('matches pullRequests union keys case-insensitively by URL, falling back to number', () => {
      const withUrl = makePullRequest({
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/Acme/App/pull/42',
      });
      const urlLess = { ...makePullRequest({ id: 'pr-9', number: 9 }), url: '' };
      const existing = makeWorkspace({ id: 'ws-1', pullRequests: [withUrl, urlLess] });
      let state = workspaceReducer(initialState, setWorkspaceEntity(existing));

      const incomingUrlCased = makePullRequest({
        id: 'pr-42',
        number: 42,
        url: 'https://github.com/acme/app/pull/42',
        status: PullRequestStatus.Merged,
      });
      const incomingUrlLess = {
        ...makePullRequest({ id: 'pr-9', number: 9, status: PullRequestStatus.Closed }),
        url: '',
      };
      state = workspaceReducer(
        state,
        setWorkspaceEntity(
          makeWorkspace({ id: 'ws-1', pullRequests: [incomingUrlCased, incomingUrlLess] }),
        ),
      );

      // Both entries dedup against their existing counterparts — no duplicates.
      expect(getItem(state.workspaces, 'ws-1')?.pullRequests).toEqual([
        incomingUrlCased,
        incomingUrlLess,
      ]);
    });
  });

  describe('updateWorkspaceEntity', () => {
    it('is a fan-out action and does not mutate workspace storage directly', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(state, updateWorkspaceEntity('ws-1', { title: 'Changed' }));

      expect(next).toBe(state);
      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Original');
    });
  });

  describe('bulkUpdateWorkspaceEntities', () => {
    it('merges partial changes into an existing workspace', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity('ws-1', {
            id: 'ws-renamed' as WorkspaceId,
            title: 'Changed',
            createdAt: '2026-02-01T00:00:00Z',
            updatedAt: '2026-02-01T00:00:00Z',
          }),
        ]),
      );

      expect(next).not.toBe(state);
      expect(next.workspaces).not.toBe(state.workspaces);
      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Changed');
      expect(getItem(next.workspaces, 'ws-1')?.branch).toBe('main'); // untouched
      expect(getItem(next.workspaces, 'ws-1')?.id).toBe('ws-1');
      expect(getItem(next.workspaces, 'ws-1')?.createdAt).toBe(ws.createdAt);
      expect(getItem(next.workspaces, 'ws-1')?.updatedAt).toBe(ws.updatedAt);
    });

    it('is a no-op when workspace does not exist', () => {
      const state = workspaceReducer(
        initialState,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-missing', { title: 'Nope' })]),
      );
      expect(state).toBe(initialState);
    });

    it('preserves state identity when changes are empty', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', {})]),
      );

      expect(next).toBe(state);
    });

    it('preserves state identity when changes match the existing workspace', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { title: 'Original' })]),
      );

      expect(next).toBe(state);
    });

    it('still applies pending archive overrides when effective fields change', () => {
      const ws = makeWorkspace({ id: 'ws-1', status: WorkspaceStatusEnum.Active, archived: false });
      const state = {
        ...workspaceReducer(initialState, setWorkspaceEntity(ws)),
        pendingArchives: { 'ws-1': true },
      };

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', {})]),
      );

      expect(next).not.toBe(state);
      expect(getItem(next.workspaces, 'ws-1')?.status).toBe(WorkspaceStatusEnum.Archived);
      expect(getItem(next.workspaces, 'ws-1')?.archived).toBe(true);
    });

    it('applies updates in original order across multiple workspaces', () => {
      let state = workspaceReducer(initialState, setWorkspaceEntity(makeWorkspace({ id: 'ws-1' })));
      state = workspaceReducer(state, setWorkspaceEntity(makeWorkspace({ id: 'ws-2' })));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity('ws-1', { title: 'First' }),
          updateWorkspaceEntity('ws-2', { title: 'Second' }),
          updateWorkspaceEntity('ws-1', { branch: 'feature' }),
          updateWorkspaceEntity('ws-1', { title: 'Final' }),
        ]),
      );

      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Final');
      expect(getItem(next.workspaces, 'ws-1')?.branch).toBe('feature');
      expect(getItem(next.workspaces, 'ws-2')?.title).toBe('Second');
    });

    it('merges the waiting flag onto an existing workspace (workspace:waiting-changed path)', () => {
      const ws = makeWorkspace({ id: 'ws-1' });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const raised = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { waiting: true })]),
      );
      expect(getItem(raised.workspaces, 'ws-1')?.waiting).toBe(true);

      const cleared = workspaceReducer(
        raised,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { waiting: false })]),
      );
      expect(getItem(cleared.workspaces, 'ws-1')?.waiting).toBe(false);
    });

    it('preserves the waiting flag across unrelated partial updates', () => {
      const ws = makeWorkspace({ id: 'ws-1', waiting: true });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { title: 'Renamed' })]),
      );

      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Renamed');
      expect(getItem(next.workspaces, 'ws-1')?.waiting).toBe(true);
    });

    it('preserves pending archive semantics across same-workspace updates', () => {
      const ws = makeWorkspace({ id: 'ws-1', status: WorkspaceStatusEnum.Active, archived: false });
      const state = {
        ...workspaceReducer(initialState, setWorkspaceEntity(ws)),
        pendingArchives: { 'ws-1': true },
      };

      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([
          updateWorkspaceEntity('ws-1', { title: 'Pending Archive' }),
          updateWorkspaceEntity('ws-1', { status: WorkspaceStatusEnum.Active }),
        ]),
      );

      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Pending Archive');
      expect(getItem(next.workspaces, 'ws-1')?.status).toBe(WorkspaceStatusEnum.Active);
    });
  });

  describe('optimistic workspace title mutations', () => {
    it('keeps the optimistic title across stale list, entity, and partial snapshots', () => {
      const original = makeWorkspace({ id: 'ws-1', title: 'Original' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(original));
      state = workspaceReducer(
        state,
        beginWorkspaceTitleMutation('ws-1', 1, 'Optimistic', 'Original'),
      );

      state = workspaceReducer(state, replaceWorkspaceList([original]));
      expect(getItem(state.workspaces, 'ws-1')?.title).toBe('Optimistic');
      state = workspaceReducer(state, setWorkspaceEntity(original));
      expect(getItem(state.workspaces, 'ws-1')?.title).toBe('Optimistic');
      state = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { title: 'Original' })]),
      );
      expect(getItem(state.workspaces, 'ws-1')?.title).toBe('Optimistic');
      expect(state.pendingTitleMutations['ws-1']?.token).toBe(1);
    });

    it('lets only the latest mutation settle and applies its authoritative response', () => {
      const original = makeWorkspace({ id: 'ws-1', title: 'Original' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(original));
      state = workspaceReducer(state, beginWorkspaceTitleMutation('ws-1', 1, 'First', 'Original'));
      state = workspaceReducer(state, beginWorkspaceTitleMutation('ws-1', 2, 'Second', 'First'));

      const afterOldSuccess = workspaceReducer(
        state,
        completeWorkspaceTitleMutation('ws-1', 1, { ...original, title: 'First' }),
      );
      expect(afterOldSuccess).toBe(state);

      const complete = workspaceReducer(
        state,
        completeWorkspaceTitleMutation('ws-1', 2, { ...original, title: 'Second' }),
      );
      expect(getItem(complete.workspaces, 'ws-1')?.title).toBe('Second');
      expect(complete.pendingTitleMutations).toEqual({});
    });

    it('rolls back only the latest failed mutation to its predecessor', () => {
      const original = makeWorkspace({ id: 'ws-1', title: 'Original' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(original));
      state = workspaceReducer(state, beginWorkspaceTitleMutation('ws-1', 1, 'First', 'Original'));
      state = workspaceReducer(state, beginWorkspaceTitleMutation('ws-1', 2, 'Second', 'Original'));

      expect(workspaceReducer(state, failWorkspaceTitleMutation('ws-1', 1))).toBe(state);
      state = workspaceReducer(state, failWorkspaceTitleMutation('ws-1', 2));
      expect(getItem(state.workspaces, 'ws-1')?.title).toBe('First');
      expect(state.pendingTitleMutations).toEqual({});
    });
  });

  describe('removeWorkspaceEntity', () => {
    it('removes a workspace entity by ID', () => {
      const ws = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, removeWorkspaceEntity('ws-1'));
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
    });

    it('is a no-op when workspace does not exist', () => {
      const state = workspaceReducer(initialState, removeWorkspaceEntity('ws-missing'));
      expect(state).toBe(initialState);
    });

    it('preserves state identity when removing an absent non-active workspace', () => {
      expect(workspaceReducer(initialState, removeWorkspaceEntity('ws-missing'))).toBe(
        initialState,
      );
    });

    it('does not affect other workspace entities', () => {
      const ws1 = makeWorkspace({ id: 'ws-1' });
      const ws2 = makeWorkspace({ id: 'ws-2' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      state = workspaceReducer(state, removeWorkspaceEntity('ws-1'));
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
      expect(getItem(state.workspaces, 'ws-2')).toEqual(ws2);
    });

    it('also removes the workspace from the ordered list', () => {
      const ws = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));

      state = workspaceReducer(state, removeWorkspaceEntity('ws-1'));
      expect(state.workspaces.ids).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('workspace selectors', () => {
  const stateWith = (ws: Partial<typeof initialState>) => ({
    workspace: { ...initialState, ...ws },
  });

  it('exposes workspace request-state selectors', () => {
    const state = stateWith({
      loading: true,
      error: 'boom',
      hasLoaded: true,
      isCreating: true,
      pendingDeletions: { 'ws-1': true },
      pendingArchives: { 'ws-2': true },
      pendingCreations: { 'ws-3': makeWorkspace({ id: 'ws-3' }) },
    });

    expect(selectWorkspaceLoading.select(state as any)).toBe(true);
    expect(selectWorkspaceHasLoaded.select(state as any)).toBe(true);
    expect(selectWorkspaceIsCreating.select(state as any)).toBe(true);
    expect(selectWorkspacePendingDeletions.select(state as any)).toEqual({ 'ws-1': true });
    expect(Object.keys(selectWorkspacePendingCreations.select(state as any))).toEqual(['ws-3']);
  });

  it('selectWorkspacesSortedByRecency sorts viewed workspaces ahead of unviewed ones', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', title: 'First' });
    const ws2 = makeWorkspace({ id: 'ws-2', title: 'Second' });
    const ws3 = makeWorkspace({ id: 'ws-3', title: 'Third' });
    const ws4 = makeWorkspace({ id: 'ws-4', title: 'Fourth' });
    const state = stateWith({
      recency: { lastViewedAt: { 'ws-1': 100, 'ws-2': 200 } },
    });

    const sorted = selectWorkspacesSortedByRecency.select(state as any, [ws3, ws1, ws4, ws2]);
    expect(sorted.map((workspace) => workspace.id)).toEqual(['ws-2', 'ws-1', 'ws-3', 'ws-4']);
  });

  // -----------------------------------------------------------------------
  // Workspace entity selectors
  // -----------------------------------------------------------------------

  it('selectWorkspaceById returns stored workspace', () => {
    const ws = makeWorkspace({ id: 'ws-1', title: 'Found' });
    const state = stateWith({ workspaces: createCollection('id', [ws]) });
    expect(selectWorkspaceById.select(state as any, 'ws-1')).toEqual(ws);
  });

  it('selectWorkspaceById returns undefined for unknown id', () => {
    expect(selectWorkspaceById.select(stateWith({}) as any, 'ws-missing')).toBeUndefined();
  });

  it('selectWorkspaceItems and emptiness use collection order', () => {
    const ws1 = makeWorkspace({ id: 'ws-1', path: 'C:\\repo\\one' });
    const ws2 = makeWorkspace({ id: 'ws-2', path: '/repo/two' });
    const state = stateWith({
      workspaces: createCollection('id', [ws2, ws1]),
    });

    expect(getItems((state as any).workspace.workspaces).map((workspace) => workspace.id)).toEqual([
      'ws-2',
      'ws-1',
    ]);
    expect(selectWorkspaceItems.select(state as any).map((workspace) => workspace.id)).toEqual([
      'ws-2',
      'ws-1',
    ]);
    expect(selectWorkspaceIsEmpty.select(state as any)).toBe(false);
  });

  describe('workspaceDeleted', () => {
    it('removes the workspace entity from the collection', () => {
      const ws1 = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      const ws2 = makeWorkspace({ id: 'ws-2' as WorkspaceId });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));
      state = workspaceReducer(state, workspaceDeleted('ws-1', []));
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
      expect(getItem(state.workspaces, 'ws-2')).toBeDefined();
    });

    it('preserves the deletion tombstone so late refetches stay blocked', () => {
      const ws = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, markWorkspacePendingDeletion('ws-1'));
      expect(state.pendingDeletions['ws-1']).toBe(true);
      state = workspaceReducer(state, workspaceDeleted('ws-1', []));
      expect(state.pendingDeletions['ws-1']).toBe(true);
    });

    it('is a no-op when only the deletion tombstone remains', () => {
      const state = workspaceReducer(initialState, markWorkspacePendingDeletion('ws-1'));
      const next = workspaceReducer(state, workspaceDeleted('ws-1', []));
      expect(next).toBe(state);
    });

    it('clears the workspace from recency.lastViewedAt map', () => {
      const ws = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, recordWorkspaceView('ws-1', 123456));
      expect(state.recency.lastViewedAt['ws-1']).toBe(123456);
      state = workspaceReducer(state, workspaceDeleted('ws-1', []));
      expect(state.recency.lastViewedAt['ws-1']).toBeUndefined();
    });

    it('clears the workspace from pendingCreations map', () => {
      const ws = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      let state = workspaceReducer(initialState, setPendingCreation(ws));
      expect(state.pendingCreations['ws-1']).toBeDefined();
      state = workspaceReducer(state, workspaceDeleted('ws-1', []));
      expect(state.pendingCreations['ws-1']).toBeUndefined();
    });

    it('survives an in-flight replaceWorkspaceList during the undo window', () => {
      const ws1 = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      const ws2 = makeWorkspace({ id: 'ws-2' as WorkspaceId });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws1));
      state = workspaceReducer(state, setWorkspaceEntity(ws2));

      // Mark pending deletion (optimistic hide)
      state = workspaceReducer(state, markWorkspacePendingDeletion('ws-1'));
      expect(state.pendingDeletions['ws-1']).toBe(true);

      // Simulate an in-flight snapshot arriving during undo window
      state = workspaceReducer(state, replaceWorkspaceList([ws1, ws2]));

      // ws-1 should still be hidden due to pendingDeletions filter
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
      expect(getItem(state.workspaces, 'ws-2')).toBeDefined();
      // pendingDeletions entry should still be there (not cleared by replaceWorkspaceList)
      expect(state.pendingDeletions['ws-1']).toBe(true);

      // Now actual delete event arrives
      state = workspaceReducer(state, workspaceDeleted('ws-1', []));

      // ws-1 should be permanently gone; the tombstone survives the event so a
      // stale response landing after it still cannot resurrect the workspace
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
      expect(state.pendingDeletions['ws-1']).toBe(true);

      state = workspaceReducer(state, replaceWorkspaceList([ws1, ws2]));
      expect(getItem(state.workspaces, 'ws-1')).toBeUndefined();
    });

    it('is a no-op when the workspace does not exist', () => {
      const ws = makeWorkspace({ id: 'ws-1' as WorkspaceId });
      const state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      const next = workspaceReducer(state, workspaceDeleted('ws-missing', []));
      expect(next).toBe(state);
    });
  });

  // -----------------------------------------------------------------------
  // Regression: deletion tombstone blocks post-delete re-insertion
  // -----------------------------------------------------------------------

  describe('deletion tombstone', () => {
    /** State right after a delete: entity removed, tombstone set. */
    function tombstonedState() {
      const ws = makeWorkspace({ id: 'ws-1' });
      let state = workspaceReducer(initialState, setWorkspaceEntity(ws));
      state = workspaceReducer(state, removeWorkspaceEntity('ws-1'));
      state = workspaceReducer(state, markWorkspacePendingDeletion('ws-1'));
      return { ws, state };
    }

    it('blocks setWorkspaceEntity re-insertion while the id is tombstoned', () => {
      const { ws, state } = tombstonedState();
      const next = workspaceReducer(state, setWorkspaceEntity(ws));
      expect(next).toBe(state);
      expect(getItem(next.workspaces, 'ws-1')).toBeUndefined();
    });

    it('blocks replaceWorkspaceList re-admission while the id is tombstoned', () => {
      const { ws, state } = tombstonedState();
      const next = workspaceReducer(state, replaceWorkspaceList([ws]));
      expect(getItem(next.workspaces, 'ws-1')).toBeUndefined();
    });

    it('blocks bulkUpdateWorkspaceEntities from touching a tombstoned id', () => {
      const ws = makeWorkspace({ id: 'ws-1', title: 'Original' });
      const base = workspaceReducer(initialState, setWorkspaceEntity(ws));
      const state = { ...base, pendingDeletions: { 'ws-1': true } };
      const next = workspaceReducer(
        state,
        bulkUpdateWorkspaceEntities([updateWorkspaceEntity('ws-1', { title: 'Changed' })]),
      );
      expect(next).toBe(state);
      expect(getItem(next.workspaces, 'ws-1')?.title).toBe('Original');
    });

    it('clearWorkspacePendingDeletion lifts the tombstone so undo can restore', () => {
      const { ws, state } = tombstonedState();
      let next = workspaceReducer(state, clearWorkspacePendingDeletion('ws-1'));
      next = workspaceReducer(next, setWorkspaceEntity(ws));
      expect(getItem(next.workspaces, 'ws-1')).toEqual(ws);
    });

    it('keeps blocking re-insertion after workspaceDeleted arrives mid-grace', () => {
      const { ws, state } = tombstonedState();
      let next = workspaceReducer(state, workspaceDeleted('ws-1', []));
      next = workspaceReducer(next, setWorkspaceEntity(ws));
      expect(getItem(next.workspaces, 'ws-1')).toBeUndefined();
      next = workspaceReducer(next, replaceWorkspaceList([ws]));
      expect(getItem(next.workspaces, 'ws-1')).toBeUndefined();
    });
  });
});
