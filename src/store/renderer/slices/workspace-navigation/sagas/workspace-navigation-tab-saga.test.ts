import { runSaga, stdChannel } from 'redux-saga';
import { describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { m } from '$shared/paraglide/messages.js';
import {
  openWorkspaceChatChanges,
  openWorkspaceCommitChangeset,
  openWorkspaceDiff,
  openWorkspaceFile,
  openWorkspaceLocalChanges,
  openWorkspaceNote,
  type JsonValue,
} from '../workspace-navigation-slice';
import { workspaceNavigationTabSaga } from './workspace-navigation-tab-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('workspaceNavigationTabSaga', () => {
  it('forces note adjacency beside an agent and preserves file jump metadata', async () => {
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
      type: 'panelLayout/openTabInAdjacentOrSplit',
      payload: {
        wsId: 'ws-1',
        sourcePanelId: 'panel-1',
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

  it('opens exact commit and tracked-diff tabs with forced source routing', async () => {
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
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
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
          data: { change, branchBaseRef: 'main', branchBaseCommitSha: 'base-sha' },
        },
      },
    });
    task.cancel();
    await task.toPromise();
  });

  it('supports an options-only runtime diff and preserves the undefined change field', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
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
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
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
      type: 'panelLayout/openTab',
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

  it('opens a chat-changes tab without options, keeping changes and title on data', async () => {
    const changes: JsonValue[] = [{ file: 'src/a.ts' }];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
    channel.put(openWorkspaceChatChanges('ws-1', changes, '1 file changed'));
    await settle();
    const payload = dispatch.mock.calls[0]?.[0]?.payload as {
      tab: { data: Record<string, unknown> };
    };
    expect(payload.tab.data.changes).toBe(changes);
    expect(payload.tab.data.title).toBe('1 file changed');
    expect(payload.tab.data.messageId).toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('opens the singleton local-changes tab with the i18n title', async () => {
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
    channel.put(openWorkspaceLocalChanges('ws-1'));
    await settle();
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      type: 'panelLayout/openTab',
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
    expect(dispatch.mock.calls[0]?.[0]?.payload?.tab?.data).toBeUndefined();
    task.cancel();
    await task.toPromise();
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
