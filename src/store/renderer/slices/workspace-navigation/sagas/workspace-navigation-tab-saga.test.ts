import { runSaga, stdChannel } from 'redux-saga';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';

import { ChangeStage, type TrackedChange } from '$features/file-tracking/types';
import { m } from '$shared/paraglide/messages.js';
import { panelLayoutReducer } from '../../panel-layout/panel-layout-slice';
import type { PanelLayoutSliceState } from '../../panel-layout/panel-layout-types';
import {
  openWorkspaceAttachment,
  openWorkspaceChatChanges,
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
  toastError: vi.fn(),
}));
vi.mock('$lib/components/chat/input/context-api', () => ({
  getAttachmentInfo: mocks.getAttachmentInfo,
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

// The attachment worker awaits a backend lookup and a dynamic toast import;
// flush macrotasks so those async chains settle before asserting.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it('opens a chat-changes tab without options, deriving the synthetic aggregate dedup id', async () => {
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
    expect(payload.tab.data.messageId).toBe('aggregate');
    task.cancel();
    await task.toPromise();
  });

  it('derives per-agent aggregate dedup ids when messageId is absent', async () => {
    const changes: JsonValue[] = [{ file: 'src/a.ts' }];
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
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
    const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
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
      layoutState = panelLayoutReducer(layoutState, action as never);
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
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }, { file: 'src/c.ts' }], 'Changes from Task A', {
        isAggregate: true,
        scopeId: 'note-1',
      }),
    );
    await settle();

    const panels = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const chatChangesTabs = panels.flatMap((panel) => panel.tabs).filter((tab) => tab.type === 'chat-changes');
    expect(chatChangesTabs).toHaveLength(2);
    const note1Tab = chatChangesTabs.find((tab) => tab.data?.messageId === 'aggregate:note:note-1')!;
    expect(note1Tab.data?.changes).toEqual([{ file: 'src/a.ts' }, { file: 'src/c.ts' }]);
    const note2Tab = chatChangesTabs.find((tab) => tab.data?.messageId === 'aggregate:note:note-2')!;
    expect(note2Tab.data?.changes).toEqual([{ file: 'src/b.ts' }]);
    task.cancel();
    await task.toPromise();
  });

  it('re-clicking an aggregate summary focuses and refreshes the existing tab; other agents get separate tabs', async () => {
    let layoutState: PanelLayoutSliceState = { byWorkspaceId: {} };
    const channel = stdChannel();
    const dispatch = vi.fn((action: { type: string; payload: unknown }) => {
      layoutState = panelLayoutReducer(layoutState, action as never);
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
      openWorkspaceChatChanges('ws-1', [{ file: 'src/a.ts' }, { file: 'src/b.ts' }], '2 files changed', {
        isAggregate: true,
        agentId: 'agent-1',
      }),
    );
    await settle();

    const afterReclick = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const mergedTabs = afterReclick.flatMap((panel) => panel.tabs).filter((tab) => tab.type === 'chat-changes');
    expect(mergedTabs).toHaveLength(1);
    expect(mergedTabs[0]!.data?.messageId).toBe('aggregate:agent-1');
    expect(mergedTabs[0]!.data?.changes).toEqual([{ file: 'src/a.ts' }, { file: 'src/b.ts' }]);
    const mergedPanel = afterReclick.find((panel) => panel.tabs.some((tab) => tab.id === mergedTabs[0]!.id))!;
    expect(mergedPanel.activeTabId).toBe(mergedTabs[0]!.id);

    channel.put(
      openWorkspaceChatChanges('ws-1', [{ file: 'src/c.ts' }], '1 file changed', {
        isAggregate: true,
        agentId: 'agent-2',
      }),
    );
    await settle();

    const panels = Object.values(layoutState.byWorkspaceId['ws-1']!.panels);
    const chatChangesTabs = panels.flatMap((panel) => panel.tabs).filter((tab) => tab.type === 'chat-changes');
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
      layoutState = panelLayoutReducer(layoutState, action as never);
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
    const chatChangesTabs = panels.flatMap((panel) => panel.tabs).filter((tab) => tab.type === 'chat-changes');
    expect(chatChangesTabs.map((tab) => tab.data?.messageId).sort()).toEqual(['msg-1', 'msg-2']);
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

  describe('openWorkspaceAttachment', () => {
    beforeEach(() => {
      mocks.getAttachmentInfo.mockReset();
      mocks.toastError.mockReset();
    });

    it('resolves the registry row by attachmentId and opens the stored path as a file tab', async () => {
      mocks.getAttachmentInfo.mockResolvedValue({
        attachmentId: 'att-1',
        fileName: 'report.pdf',
        size: 10,
        uploadedAt: '2026-08-12T00:00:00Z',
        path: '.intent/attachments/report.pdf',
        exists: true,
      });
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => ({}) }, workspaceNavigationTabSaga);
      channel.put(openWorkspaceAttachment('ws-1', 'att-1', 'report.pdf'));
      await flush();

      expect(mocks.getAttachmentInfo).toHaveBeenCalledWith('att-1');
      expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
        type: 'workspaceNavigation/openWorkspaceFile',
        payload: ['ws-1', '.intent/attachments/report.pdf'],
      });
      expect(mocks.toastError).not.toHaveBeenCalled();
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
