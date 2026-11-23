import { describe, expect, it } from 'vitest';
import { CHIEF_WORKSPACE_ID } from './types/branded-ids';
import { notificationClickTarget } from './notification-click-target';

describe('notificationClickTarget', () => {
  it('targets the workspace and the agent that finished', () => {
    expect(notificationClickTarget('ws-1', 'agent-1')).toEqual({
      workspaceId: 'ws-1',
      agentId: 'agent-1',
    });
  });

  it('marks only the Assistant workspace as chief', () => {
    expect(notificationClickTarget(CHIEF_WORKSPACE_ID, 'agent-1')).toEqual({
      workspaceId: CHIEF_WORKSPACE_ID,
      chief: true,
      agentId: 'agent-1',
    });
  });

  it('omits a missing agent', () => {
    expect(notificationClickTarget('ws-1', undefined)).toEqual({ workspaceId: 'ws-1' });
    expect(notificationClickTarget('ws-1', '')).toEqual({ workspaceId: 'ws-1' });
  });

  it('has no target without a workspace', () => {
    expect(notificationClickTarget(undefined, 'agent-1')).toBeUndefined();
    expect(notificationClickTarget('', 'agent-1')).toBeUndefined();
  });
});
