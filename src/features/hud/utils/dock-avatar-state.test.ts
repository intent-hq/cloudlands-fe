import { describe, expect, it } from 'vitest';
import { AgentStatus, type AgentSession, type Workspace } from '$shared/types';
import { dockWorkspaceAvatarState, type DockAvatarItem } from './dock-avatar-state';
import { dockStatusGroups } from './dock-status-groups';

function unreadWorkspace(extra: Partial<DockAvatarItem> = {}): DockAvatarItem {
  return {
    workspace: {
      id: 'workspace',
      displayStatus: 'complete',
      attention: 'unread',
      agentSummary: { agentIds: ['read-agent', 'unread-agent'] },
    } as Workspace,
    ...extra,
  };
}

function session(status = AgentStatus.Idle, extra: Partial<AgentSession> = {}): AgentSession {
  return { id: 'read-agent', status, hasUnread: false, ...extra } as AgentSession;
}

describe('dockWorkspaceAvatarState', () => {
  it.each([AgentStatus.Idle, AgentStatus.Completed])(
    'shows workspace unread activity when its first agent is %s and read',
    (status) => {
      const item = unreadWorkspace();
      expect(dockStatusGroups([item])).toEqual([{ status: 'unread', count: 1 }]);
      expect(dockWorkspaceAvatarState(item, session(status))).toBe('unread');
    },
  );

  it('keeps canonical workspace unread activity when the row unread flag lags', () => {
    expect(dockWorkspaceAvatarState(unreadWorkspace({ isUnread: false }))).toBe('unread');
  });

  it('drops the aggregate unread state after the workspace is read', () => {
    const item = unreadWorkspace();
    expect(dockWorkspaceAvatarState(item, session())).toBe('unread');
    const read = { ...item, workspace: { ...item.workspace, attention: undefined } };
    expect(dockStatusGroups([read])).toEqual([]);
    expect(dockWorkspaceAvatarState(read, session())).toBe('idle');
  });

  it('preserves the selected agent unread signal', () => {
    const item = unreadWorkspace();
    item.workspace.attention = undefined;
    expect(dockWorkspaceAvatarState(item, session(AgentStatus.Idle, { hasUnread: true }))).toBe(
      'unread',
    );
  });

  it('keeps live work, questions, failure and waiting ahead of unread activity', () => {
    expect(
      dockWorkspaceAvatarState(
        unreadWorkspace(),
        session(AgentStatus.Processing, { isResponding: true }),
      ),
    ).toBe('running');
    expect(dockWorkspaceAvatarState(unreadWorkspace({ badgeKind: 'question' }), session())).toBe(
      'question',
    );
    expect(dockWorkspaceAvatarState(unreadWorkspace(), session(AgentStatus.Error))).toBe('failed');
    expect(
      dockWorkspaceAvatarState(
        unreadWorkspace(),
        session(AgentStatus.Idle, { isWaitingForOtherAgents: true }),
      ),
    ).toBe('waiting');
    expect(
      dockWorkspaceAvatarState(
        unreadWorkspace({ isRunning: true }),
        session(AgentStatus.Completed),
      ),
    ).toBe('running');
  });
});
