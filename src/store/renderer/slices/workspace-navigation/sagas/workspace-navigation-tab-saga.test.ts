import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { m } from '$shared/paraglide/messages.js';
import {
  emptyWorkspaceState,
  openTabInRightmostColumn,
  panelLayoutReducer,
} from '../../panel-layout/panel-layout-slice';
import type { PanelLayoutSliceState } from '../../panel-layout/panel-layout-types';
import {
  openWorkspaceActivityChanges,
  openWorkspaceAttachment,
  openWorkspaceBrowser,
  openWorkspaceChatChanges,
  openWorkspaceCodeReview,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
  type JsonValue,
} from '../workspace-navigation-slice';
import { workspaceNavigationTabSaga } from './workspace-navigation-tab-saga';

const mocks = vi.hoisted(() => ({
  getAttachmentInfo: vi.fn(),
  downloadAttachment: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('$lib/components/chat/input/context-api', () => ({
  getAttachmentInfo: mocks.getAttachmentInfo,
  downloadAttachment: mocks.downloadAttachment,
}));
vi.mock('svelte-sonner', () => ({
  toast: { error: mocks.toastError, success: mocks.toastSuccess },
}));

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const noFocusedPanelState = {
  panelLayout: { byWorkspaceId: { 'ws-1': { focusedPanelId: null } } },
};

function reducePanelAction(state: PanelLayoutSliceState, action: any): PanelLayoutSliceState {
  if (action.type !== 'panelLayout/openTabInRightmostColumnRequested') {
    return panelLayoutReducer(state, action);
  }
  const { wsId, tab, force, allowDuplicate, newTabId, timestamp } = action.payload;
  return panelLayoutReducer(
    state,
    openTabInRightmostColumn(wsId, tab, { force, allowDuplicate, newTabId }, timestamp),
  );
}

// The attachment worker awaits a backend lookup and a dynamic toast import;
// flush macrotasks so those async chains settle before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('workspaceNavigationTabSaga', () => {
  it('opens the sidebar all-changes request as a local-changes panel tab', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );

    channel.put(openWorkspaceLocalChanges('ws-1'));
    await settle();

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInRightmostColumnRequested',
        payload: expect.objectContaining({
          wsId: 'ws-1',
          force: true,
          tab: expect.objectContaining({
            type: 'local-changes',
            workspaceId: 'ws-1',
            closable: true,
            data: { gitRootId: undefined },
          }),
        }),
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('threads gitRootId into a secondary-root all-changes tab', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );

    channel.put(openWorkspaceLocalChanges('ws-1', { gitRootId: 'root-9' }));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          tab: expect.objectContaining({
            type: 'local-changes',
            data: { gitRootId: 'root-9' },
          }),
        }),
      }),
    );
    task.cancel();
    await task.toPromise();
  });

  it('clears secondary-root identity when the singleton all-changes tab returns to primary', async () => {
    let layoutState: PanelLayoutSliceState = { byWorkspaceId: {} };
    const channel = stdChannel();
    const dispatch = vi.fn((action: { type: string; payload: unknown }) => {
      layoutState = reducePanelAction(layoutState, action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ panelLayout: layoutState }) },
      workspaceNavigationTabSaga,
    );

    channel.put(openWorkspaceLocalChanges('ws-1', { gitRootId: 'root-9' }));
    await settle();
    channel.put(openWorkspaceLocalChanges('ws-1'));
    await settle();

    const tabs = Object.values(layoutState.byWorkspaceId['ws-1']!.panels).flatMap(
      (panel) => panel.tabs,
    );
    expect(tabs.filter((tab) => tab.type === 'local-changes')).toHaveLength(1);
    expect(tabs.find((tab) => tab.type === 'local-changes')?.data?.gitRootId).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('routes other panel-backed workspace navigation actions through the panel layout', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = {
      panelLayout: {
        byWorkspaceId: { 'ws-1': { focusedPanelId: 'panel-focused' } },
      },
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, workspaceNavigationTabSaga);
    const event = { id: 'event-1', type: 'file:changed', timestamp: 42 } as never;

    channel.put(openWorkspaceBrowser('ws-1', 'https://example.com'));
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ filePath: 'src/a.ts' }], '1 file changed', {
        sourcePanelId: 'panel-agent',
        messageId: 'message-1',
        agentId: 'agent-1',
        turnNumber: 2,
      }),
    );
    channel.put(openWorkspaceActivityChanges('ws-1', event));
    channel.put(openWorkspaceCodeReview('ws-1', { status: 'completed', result: 'Looks good' }));
    await settle();

    expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'panelLayout/openTab',
      'panelLayout/openTab',
      'panelLayout/openTab',
      'panelLayout/openTab',
    ]);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      payload: {
        panelId: 'panel-focused',
        tab: { type: 'browser', browserUrl: 'https://example.com' },
      },
    });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      payload: {
        panelId: 'panel-agent',
        force: true,
        tab: {
          type: 'chat-changes',
          data: {
            changes: [{ filePath: 'src/a.ts' }],
            messageId: 'message-1',
            agentId: 'agent-1',
            turnNumber: 2,
          },
        },
      },
    });
    expect(dispatch.mock.calls[2]?.[0]).toMatchObject({
      payload: {
        panelId: 'panel-focused',
        tab: { type: 'activity-changes', data: { event } },
      },
    });
    expect(dispatch.mock.calls[3]?.[0]).toMatchObject({
      payload: {
        panelId: 'panel-focused',
        tab: { type: 'code-review', data: { status: 'completed', result: 'Looks good' } },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('requests fixed-column-safe adjacent routing for note links', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = {
      workspaceNotes: {
        byWorkspaceId: {
          'ws-1': { notes: createCollection('id', [{ id: 'note-1', title: 'Plan' }]) },
        },
      },
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, workspaceNavigationTabSaga);
    channel.put(
      openWorkspaceNote('ws-1', 'note-1', {
        sourcePanelId: 'panel-note',
        openInAdjacentPanel: true,
      }),
    );
    await settle();

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInAdjacentOrSplit',
      payload: {
        sourcePanelId: 'panel-note',
        force: true,
        tab: { type: 'note', noteId: 'note-1' },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('keeps an unmodified agent note in its source panel and preserves adjacent file metadata', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(42);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const state = {
      panelLayout: {
        byWorkspaceId: {
          'ws-1': {
            panels: {
              'panel-1': {
                id: 'panel-1',
                activeTabId: 'agent-tab',
                tabs: [
                  {
                    id: 'agent-tab',
                    type: 'agent',
                    title: 'Agent',
                    agentId: 'agent-1',
                    closable: true,
                  },
                ],
              },
            },
          },
        },
      },
      workspaceNotes: {
        byWorkspaceId: {
          'ws-1': {
            notes: createCollection('id', [{ id: 'note-1', title: 'Plan' }]),
          },
        },
      },
    };
    const task = runSaga({ channel, dispatch, getState: () => state }, workspaceNavigationTabSaga);
    channel.put(openWorkspaceNote('ws-1', 'note-1', { sourcePanelId: 'panel-1' }));
    channel.put(
      openWorkspaceFile('ws-1', 'src/a.ts', {
        sourcePanelId: 'panel-1',
        openInAdjacentPanel: true,
        line: 7,
      }),
    );
    await settle();

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTab',
      payload: {
        wsId: 'ws-1',
        panelId: 'panel-1',
        force: true,
        tab: {
          type: 'note',
          title: 'Plan',
          noteId: 'note-1',
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInAdjacentOrSplit',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-1',
        force: true,
        tab: {
          type: 'file',
          title: 'a.ts',
          filePath: 'src/a.ts',
          workspaceId: 'ws-1',
          closable: true,
          data: { line: 7, jumpTimestamp: 42 },
        },
      },
    });
    task.cancel();
    await task.toPromise();
    vi.restoreAllMocks();
  });

  it.each([
    ['docs/chl-spec.md:2471', undefined, 'docs/chl-spec.md', 'chl-spec.md', 2471],
    ['src/a.ts:10:5', undefined, 'src/a.ts', 'a.ts', 10],
    ['src/a.ts#L10-20', undefined, 'src/a.ts', 'a.ts', 10],
    ['src/a.ts:10', { line: 3 }, 'src/a.ts', 'a.ts', 3],
  ])(
    'normalizes a line suffix before opening %s',
    async (filePath, options, expectedPath, expectedTitle, expectedLine) => {
      vi.spyOn(Date, 'now').mockReturnValue(42);
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga(
        { channel, dispatch, getState: () => noFocusedPanelState },
        workspaceNavigationTabSaga,
      );

      channel.put(openWorkspaceFile('ws-1', filePath, options));
      await settle();

      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        payload: {
          tab: {
            type: 'file',
            title: expectedTitle,
            filePath: expectedPath,
            data: { line: expectedLine, jumpTimestamp: 42 },
          },
        },
      });
      task.cancel();
      await task.toPromise();
      vi.restoreAllMocks();
    },
  );

  // Regression tests for intent-hq/monorepo#3398: a mod-clicked note-task link
  // (openInNewAdjacentPanel) permits a duplicate instead of activating an
  // equivalent note tab that is already open elsewhere.
  describe('mod-click note routing into the adjacent column (monorepo#3398)', () => {
    const notesState = {
      byWorkspaceId: {
        'ws-1': { notes: createCollection('id', [{ id: 'note-1', title: 'Plan' }]) },
      },
    };

    function runWithLayout(workspaceLayout: Record<string, unknown>) {
      const channel = stdChannel();
      let state: any = {
        workspaceNotes: notesState,
        panelLayout: { byWorkspaceId: { 'ws-1': { ...emptyWorkspaceState, ...workspaceLayout } } },
      };
      const dispatch = vi.fn((action: any) => {
        state = { ...state, panelLayout: reducePanelAction(state.panelLayout, action) };
      });
      const task = runSaga(
        { channel, dispatch, getState: () => state },
        workspaceNavigationTabSaga,
      );
      return { channel, task, getLayout: () => state.panelLayout.byWorkspaceId['ws-1'] };
    }

    it('opens a duplicate in the right neighbor when the note is already open there', async () => {
      const { channel, task, getLayout } = runWithLayout({
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'left' },
            { type: 'panel', panelId: 'right' },
          ],
          sizes: [50, 50],
        },
        panels: {
          left: {
            id: 'left',
            tabs: [{ id: 'spec-tab', type: 'note', title: 'Spec', noteId: 'spec' }],
            activeTabId: 'spec-tab',
          },
          right: {
            id: 'right',
            tabs: [
              { id: 'existing-note', type: 'note', title: 'Plan', noteId: 'note-1' },
              { id: 'right-file', type: 'file', title: 'a.ts', filePath: 'a.ts' },
            ],
            activeTabId: 'right-file',
          },
        },
        focusedPanelId: 'left',
        columnCount: 2,
      });

      channel.put(
        openWorkspaceNote('ws-1', 'note-1', {
          sourcePanelId: 'left',
          openInAdjacentPanel: true,
          openInNewAdjacentPanel: true,
        }),
      );
      await settle();

      const ws = getLayout();
      const order = ws.root.children.map((child: any) => child.panelId);
      expect(order).toEqual(['left', 'right']);
      expect(ws.panels.right.tabs).toEqual([
        expect.objectContaining({ id: 'existing-note' }),
        expect.objectContaining({ id: 'right-file' }),
        expect.objectContaining({ type: 'note', noteId: 'note-1', title: 'Plan' }),
      ]);
      expect(ws.panels.right.activeTabId).toBe(ws.panels.right.tabs[2].id);
      expect(ws.pendingFocusTabId).toBe(ws.panels.right.tabs[2].id);
      task.cancel();
      await task.toPromise();
    });

    it('opens in the right neighbor when the note is not open anywhere', async () => {
      const { channel, task, getLayout } = runWithLayout({
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'left' },
            { type: 'panel', panelId: 'right' },
          ],
          sizes: [50, 50],
        },
        panels: {
          left: {
            id: 'left',
            tabs: [{ id: 'spec-tab', type: 'note', title: 'Spec', noteId: 'spec' }],
            activeTabId: 'spec-tab',
          },
          right: {
            id: 'right',
            tabs: [{ id: 'right-file', type: 'file', title: 'a.ts', filePath: 'a.ts' }],
            activeTabId: 'right-file',
          },
        },
        focusedPanelId: 'left',
        columnCount: 2,
      });

      channel.put(
        openWorkspaceNote('ws-1', 'note-1', {
          sourcePanelId: 'left',
          openInAdjacentPanel: true,
          openInNewAdjacentPanel: true,
        }),
      );
      await settle();

      const ws = getLayout();
      const order = ws.root.children.map((child: any) => child.panelId);
      expect(order).toEqual(['left', 'right']);
      expect(ws.panels.right.tabs).toEqual([
        expect.objectContaining({ id: 'right-file' }),
        expect.objectContaining({ type: 'note', noteId: 'note-1' }),
      ]);
      expect(ws.panels.right.activeTabId).toBe(ws.panels.right.tabs[1].id);
      expect(ws.pendingFocusTabId).toBe(ws.panels.right.tabs[1].id);
      task.cancel();
      await task.toPromise();
    });

    it('falls back to a duplicate tab in the next column at the four-column limit', async () => {
      const panel = (id: string) => ({
        id,
        tabs: [{ id: `${id}-tab`, type: 'file', title: `${id}.ts`, filePath: `${id}.ts` }],
        activeTabId: `${id}-tab`,
      });
      const { channel, task, getLayout } = runWithLayout({
        root: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'panel', panelId: 'p1' },
            { type: 'panel', panelId: 'p2' },
            { type: 'panel', panelId: 'p3' },
            { type: 'panel', panelId: 'p4' },
          ],
          sizes: [25, 25, 25, 25],
        },
        panels: {
          p1: panel('p1'),
          p2: panel('p2'),
          p3: panel('p3'),
          p4: {
            id: 'p4',
            tabs: [{ id: 'existing-note', type: 'note', title: 'Plan', noteId: 'note-1' }],
            activeTabId: 'existing-note',
          },
        },
        focusedPanelId: 'p1',
        columnCount: 4,
      });

      channel.put(
        openWorkspaceNote('ws-1', 'note-1', {
          sourcePanelId: 'p1',
          openInAdjacentPanel: true,
          openInNewAdjacentPanel: true,
        }),
      );
      await settle();

      const ws = getLayout();
      expect(ws.root.children.map((child: any) => child.panelId)).toEqual(['p1', 'p2', 'p3', 'p4']);
      expect(ws.panels.p2.tabs).toEqual([
        expect.objectContaining({ id: 'p2-tab' }),
        expect.objectContaining({ type: 'note', noteId: 'note-1' }),
      ]);
      expect(ws.panels.p2.activeTabId).toBe(ws.panels.p2.tabs[1].id);
      // The far column's copy stays untouched.
      expect(ws.panels.p4.tabs).toEqual([expect.objectContaining({ id: 'existing-note' })]);
      task.cancel();
      await task.toPromise();
    });
  });

  it('uses source context for adjacent commit and same-panel diff routing', async () => {
    const change = {
      id: 'change-1',
      file: 'src/foo.ts',
      relativePath: 'src/foo.ts',
      stage: ChangeStage.Unstaged,
      stats: { additions: 3, deletions: 1 },
      status: 'modified',
      attribution: { manual: true, timestamp: 0 },
    } as TrackedChange;
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceCommitChangeset('ws-1', 'abcdef123456', 'feat: exact shape', {
        sourcePanelId: 'panel-a',
        openInAdjacentPanel: true,
      }),
    );
    await settle();
    channel.put(
      openWorkspaceDiff('ws-1', change, {
        sourcePanelId: 'panel-b',
        branchBaseRef: 'main',
        branchBaseCommitSha: 'base-sha',
        gitRootId: 'root-9',
        gitRootPath: '/repo/packages/sub',
      }),
    );
    await settle();

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInAdjacentOrSplit',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-a',
        force: true,
        tab: {
          type: 'changes',
          title: 'abcdef1: feat: exact shape',
          workspaceId: 'ws-1',
          closable: true,
          data: { commitHash: 'abcdef123456', commitMessage: 'feat: exact shape' },
        },
      },
    });
    expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
      type: 'panelLayout/openTab',
      payload: {
        wsId: 'ws-1',
        panelId: 'panel-b',
        force: true,
        tab: {
          type: 'diff',
          title: 'foo.ts',
          diffPath: 'src/foo.ts',
          workspaceId: 'ws-1',
          closable: true,
          data: {
            change,
            branchBaseRef: 'main',
            branchBaseCommitSha: 'base-sha',
            gitRootId: 'root-9',
            gitRootPath: '/repo/packages/sub',
          },
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('threads gitRootId into the commit changeset tab data and omits it when absent', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );

    channel.put(
      openWorkspaceCommitChangeset('ws-1', 'abcdef123456', 'feat: scoped', {
        gitRootId: 'root-1',
      }),
    );
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    channel.put(openWorkspaceCommitChangeset('ws-1', 'abcdef123456', 'feat: primary'));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));

    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        force: true,
        tab: {
          type: 'changes',
          workspaceId: 'ws-1',
          data: {
            commitHash: 'abcdef123456',
            commitMessage: 'feat: scoped',
            gitRootId: 'root-1',
          },
        },
      },
    });
    const primaryTabData = dispatch.mock.calls[1]?.[0]?.payload?.tab?.data;
    expect(primaryTabData).toEqual({
      commitHash: 'abcdef123456',
      commitMessage: 'feat: primary',
    });
    task.cancel();
    await task.toPromise();
  });

  it('supports an options-only runtime diff and preserves the undefined change field', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceDiff('ws-1', undefined as never, {
        filePath: 'overrides/runtime.ts',
        sourcePanelId: 'panel-runtime',
        openInAdjacentPanel: true,
      }),
    );
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInAdjacentOrSplit',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-runtime',
        force: true,
        tab: {
          type: 'diff',
          title: 'runtime.ts',
          diffPath: 'overrides/runtime.ts',
          workspaceId: 'ws-1',
          closable: true,
          data: { change: undefined },
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('opens a chat-changes tab carrying changes and the messageId dedup key', async () => {
    const changes: JsonValue[] = [
      { file: 'src/a.ts', additions: 2, deletions: 1 },
      { file: 'src/b.ts', additions: 5, deletions: 0 },
    ];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, '2 files changed', {
        messageId: 'msg-1',
        isAggregate: true,
        agentId: 'agent-1',
        turnNumber: 4,
      }),
    );
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        force: true,
        tab: {
          type: 'chat-changes',
          title: '2 files changed',
          workspaceId: 'ws-1',
          closable: true,
          data: {
            changes,
            title: '2 files changed',
            messageId: 'msg-1',
            isAggregate: true,
            agentId: 'agent-1',
            turnNumber: 4,
          },
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('opens a chat-changes tab without options, deriving the synthetic aggregate dedup id', async () => {
    const changes: JsonValue[] = [{ file: 'src/a.ts' }];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(openWorkspaceChatChanges('ws-1', changes, '1 file changed'));
    await settle();
    const payload = dispatch.mock.calls[0]?.[0]?.payload as {
      tab: { data: Record<string, unknown> };
    };
    expect(payload.tab.data.changes).toBe(changes);
    expect(payload.tab.data.title).toBe('1 file changed');
    expect(payload.tab.data.messageId).toBe('aggregate');
    task.cancel();
    await task.toPromise();
  });

  it('derives per-agent aggregate dedup ids when messageId is absent', async () => {
    const changes: JsonValue[] = [{ file: 'src/a.ts' }];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, '1 file changed', {
        isAggregate: true,
        agentId: 'agent-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, '1 file changed', {
        isAggregate: true,
        agentId: 'agent-2',
      }),
    );
    await settle();
    const dataOf = (index: number) =>
      (dispatch.mock.calls[index]?.[0]?.payload as { tab: { data: Record<string, unknown> } }).tab
        .data;
    expect(dataOf(0).messageId).toBe('aggregate:agent-1');
    expect(dataOf(0).isAggregate).toBe(true);
    expect(dataOf(0).agentId).toBe('agent-1');
    expect(dataOf(1).messageId).toBe('aggregate:agent-2');
    task.cancel();
    await task.toPromise();
  });

  it('derives note-scoped aggregate dedup ids from scopeId, with messageId and agentId taking priority', async () => {
    const changes: JsonValue[] = [{ file: 'src/a.ts' }];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, 'Changes from Task A', {
        isAggregate: true,
        scopeId: 'note-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, 'Changes from Task B', {
        isAggregate: true,
        scopeId: 'note-2',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, '1 file changed', {
        isAggregate: true,
        agentId: 'agent-1',
        scopeId: 'note-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', changes, '1 file changed', {
        messageId: 'msg-1',
        agentId: 'agent-1',
        scopeId: 'note-1',
      }),
    );
    await settle();
    const dataOf = (index: number) =>
      (dispatch.mock.calls[index]?.[0]?.payload as { tab: { data: Record<string, unknown> } }).tab
        .data;
    expect(dataOf(0).messageId).toBe('aggregate:note:note-1');
    expect(dataOf(1).messageId).toBe('aggregate:note:note-2');
    expect(dataOf(2).messageId).toBe('aggregate:agent-1');
    expect(dataOf(3).messageId).toBe('msg-1');
    task.cancel();
    await task.toPromise();
  });

  it('dedups and refreshes re-clicks of the same note aggregate while other notes get separate tabs', async () => {
    let layoutState: PanelLayoutSliceState = { byWorkspaceId: {} };
    const channel = stdChannel();
    const dispatch = vi.fn((action: { type: string; payload: unknown }) => {
      layoutState = reducePanelAction(layoutState, action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ panelLayout: layoutState }) },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }], 'Changes from Task A', {
        isAggregate: true,
        scopeId: 'note-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/b.ts' }], 'Changes from Task B', {
        isAggregate: true,
        scopeId: 'note-2',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges(
        'ws-1',
        [{ file: 'src/a.ts' }, { file: 'src/c.ts' }],
        'Changes from Task A',
        {
          isAggregate: true,
          scopeId: 'note-1',
        },
      ),
    );
    await settle();

    const panels = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const chatChangesTabs = panels
      .flatMap((panel) => panel.tabs)
      .filter((tab) => tab.type === 'chat-changes');
    expect(chatChangesTabs).toHaveLength(2);
    const note1Tab = chatChangesTabs.find(
      (tab) => tab.data?.messageId === 'aggregate:note:note-1',
    )!;
    expect(note1Tab.data?.changes).toEqual([{ file: 'src/a.ts' }, { file: 'src/c.ts' }]);
    const note2Tab = chatChangesTabs.find(
      (tab) => tab.data?.messageId === 'aggregate:note:note-2',
    )!;
    expect(note2Tab.data?.changes).toEqual([{ file: 'src/b.ts' }]);
    task.cancel();
    await task.toPromise();
  });

  it('re-clicking an aggregate summary focuses and refreshes the existing tab; other agents get separate tabs', async () => {
    let layoutState: PanelLayoutSliceState = { byWorkspaceId: {} };
    const channel = stdChannel();
    const dispatch = vi.fn((action: { type: string; payload: unknown }) => {
      layoutState = reducePanelAction(layoutState, action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ panelLayout: layoutState }) },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }], '1 file changed', {
        isAggregate: true,
        agentId: 'agent-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges(
        'ws-1',
        [{ file: 'src/a.ts' }, { file: 'src/b.ts' }],
        '2 files changed',
        {
          isAggregate: true,
          agentId: 'agent-1',
        },
      ),
    );
    await settle();

    const afterReclick = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const mergedTabs = afterReclick
      .flatMap((panel) => panel.tabs)
      .filter((tab) => tab.type === 'chat-changes');
    expect(mergedTabs).toHaveLength(1);
    expect(mergedTabs[0]!.data?.messageId).toBe('aggregate:agent-1');
    expect(mergedTabs[0]!.data?.changes).toEqual([{ file: 'src/a.ts' }, { file: 'src/b.ts' }]);
    const mergedPanel = afterReclick.find((panel) =>
      panel.tabs.some((tab) => tab.id === mergedTabs[0]!.id),
    )!;
    expect(mergedPanel.activeTabId).toBe(mergedTabs[0]!.id);

    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/c.ts' }], '1 file changed', {
        isAggregate: true,
        agentId: 'agent-2',
      }),
    );
    await settle();

    const panels = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const chatChangesTabs = panels
      .flatMap((panel) => panel.tabs)
      .filter((tab) => tab.type === 'chat-changes');
    expect(chatChangesTabs).toHaveLength(2);
    const agent2Tab = chatChangesTabs.find((tab) => tab.data?.messageId === 'aggregate:agent-2')!;
    expect(agent2Tab.data?.changes).toEqual([{ file: 'src/c.ts' }]);
    task.cancel();
    await task.toPromise();
  });

  it('re-clicking the same per-message summary dedups on the unchanged messageId', async () => {
    let layoutState: PanelLayoutSliceState = { byWorkspaceId: {} };
    const channel = stdChannel();
    const dispatch = vi.fn((action: { type: string; payload: unknown }) => {
      layoutState = reducePanelAction(layoutState, action);
      return action;
    });
    const task = runSaga(
      { channel, dispatch, getState: () => ({ panelLayout: layoutState }) },
      workspaceNavigationTabSaga,
    );
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }], '1 file changed', {
        messageId: 'msg-1',
        agentId: 'agent-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }], '1 file changed', {
        messageId: 'msg-1',
        agentId: 'agent-1',
      }),
    );
    await settle();
    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/b.ts' }], '1 file changed', {
        messageId: 'msg-2',
        agentId: 'agent-1',
      }),
    );
    await settle();

    const panels = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const chatChangesTabs = panels
      .flatMap((panel) => panel.tabs)
      .filter((tab) => tab.type === 'chat-changes');
    expect(chatChangesTabs.map((tab) => tab.data?.messageId).sort()).toEqual(['msg-1', 'msg-2']);
    task.cancel();
    await task.toPromise();
  });

  it('opens the singleton local-changes tab with the i18n title', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      { channel, dispatch, getState: () => noFocusedPanelState },
      workspaceNavigationTabSaga,
    );
    channel.put(openWorkspaceLocalChanges('ws-1'));
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTabInRightmostColumnRequested',
      payload: {
        wsId: 'ws-1',
        force: true,
        tab: {
          type: 'local-changes',
          title: m.layout_presetExecutor_allChanges_title(),
          workspaceId: 'ws-1',
          closable: true,
        },
      },
    });
    expect(dispatch.mock.calls[0]?.[0]?.payload?.tab?.data).toEqual({ gitRootId: undefined });
    task.cancel();
    await task.toPromise();
  });

  describe('openWorkspaceAttachment', () => {
    beforeEach(() => {
      mocks.getAttachmentInfo.mockReset();
      mocks.downloadAttachment.mockReset();
      mocks.toastError.mockReset();
      mocks.toastSuccess.mockReset();
    });

    it('resolves the registry row by attachmentId and opens an editor-friendly path as a file tab', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'report.md',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/report.md',
        exists: true,
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'report.md'));
      await flush();

      expect(mocks.getAttachmentInfo).toHaveBeenCalledWith('att-1');
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        type: 'workspaceNavigation/openWorkspaceFile',
        payload: ['ws-1', '.intent/attachments/report.md'],
      });
      expect(mocks.downloadAttachment).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('downloads a binary attachment via the save-dialog IPC instead of opening a tab', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'archive.zip',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/archive.zip',
        exists: true,
      });
      mocks.downloadAttachment.mockResolvedValue({
        success: true,
        data: { filePath: '/home/u/Downloads/archive.zip' },
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'archive.zip'));
      await flush();

      expect(mocks.downloadAttachment).toHaveBeenCalledWith(
        'ws-1',
        '.intent/attachments/archive.zip',
        'archive.zip',
      );
      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        m.chat_chatMessage_attachmentDownloaded_toast({
          name: 'archive.zip',
          filePath: '/home/u/Downloads/archive.zip',
        }),
      );
      expect(mocks.toastError).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('treats a canceled save dialog as a silent no-op', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'photo.png',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/photo.png',
        exists: true,
      });
      mocks.downloadAttachment.mockResolvedValue({ success: false, canceled: true });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'photo.png'));
      await flush();

      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });

    it('surfaces a failure toast when the download IPC reports an error', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'photo.png',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/photo.png',
        exists: true,
      });
      mocks.downloadAttachment.mockResolvedValue({
        success: false,
        error: { code: 'DOWNLOAD_FAILED', message: 'Failed to download: photo.png' },
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'photo.png'));
      await flush();

      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith('Failed to download: photo.png');
      task.cancel();
      await task.toPromise();
    });

    it('surfaces the download-failed toast (not open-failed) when the download IPC throws', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'photo.png',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/photo.png',
        exists: true,
      });
      mocks.downloadAttachment.mockRejectedValue(new Error('bridge unavailable'));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'photo.png'));
      await flush();

      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        m.chat_chatMessage_attachmentDownloadFailed_error({ name: 'photo.png' }),
      );
      task.cancel();
      await task.toPromise();
    });

    it('surfaces a missing-file toast without opening a tab when the file was deleted out-of-band', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'report.pdf',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/report.pdf',
        exists: false,
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'report.pdf'));
      await flush();

      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        m.chat_chatMessage_attachmentMissing_error({ name: 'report.pdf' }),
      );
      task.cancel();
      await task.toPromise();
    });

    it('surfaces a failure toast labeled with the block fileName when the lookup rejects', async () => {
      mocks.getAttachmentInfo.mockRejectedValue(new Error('unknown id'));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-gone', 'notes.txt'));
      await flush();

      expect(dispatch).not.toHaveBeenCalled();
      expect(mocks.toastError).toHaveBeenCalledWith(
        m.chat_chatMessage_attachmentOpenFailed_error({ name: 'notes.txt' }),
      );
      task.cancel();
      await task.toPromise();
    });

    it('ignores requests without a workspace or attachment id', async () => {
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('', 'att-1', 'a.txt'));
      await settle();
      channel.put(openWorkspaceAttachment('ws-1', '', 'a.txt'));
      await settle();
      expect(mocks.getAttachmentInfo).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });
  });

  it('ignores commit, file, note, diff, chat-changes, and local-changes requests without resolvable identities', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
    channel.put(openWorkspaceCommitChangeset('ws-1'));
    await settle();
    channel.put(openWorkspaceFile('ws-1', ''));
    await settle();
    channel.put(openWorkspaceNote('ws-1', ''));
    await settle();
    channel.put(openWorkspaceDiff('ws-1', undefined as never));
    await settle();
    channel.put(openWorkspaceChatChanges('ws-1', [], 'title'));
    await settle();
    channel.put(openWorkspaceChatChanges('', [{ file: 'a.ts' }], 'title'));
    await settle();
    channel.put(openWorkspaceLocalChanges(''));
    await settle();
    expect(dispatch).not.toHaveBeenCalled();
    task.cancel();
    await task.toPromise();
  });
});
