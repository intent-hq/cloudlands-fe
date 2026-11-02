import { describe, expect, it } from 'vitest';
import type { WorkspaceStatusPresentationInput } from '$lib/components/workspace/utils/workspace-status-presentation';
import { dockStatusGroups } from './dock-status-groups';

const row = (input: Partial<WorkspaceStatusPresentationInput>) => ({
  workspace: {
    displayStatus: 'not_started',
    activity: undefined,
    attention: undefined,
    waiting: false,
    ...input,
  } as WorkspaceStatusPresentationInput,
});

describe('dockStatusGroups', () => {
  it('counts the live notch case as one in progress and three unread', () => {
    const rows = [
      row({ displayStatus: 'in_progress' }),
      row({ displayStatus: 'complete', attention: 'unread' }),
      row({ displayStatus: 'idle', attention: 'unread' }),
      row({ displayStatus: 'not_started', attention: 'unread' }),
    ];
    expect(dockStatusGroups(rows)).toEqual([
      { status: 'in_progress', count: 1 },
      { status: 'unread', count: 3 },
    ]);
  });

  it('orders groups failed, blocked, needs attention, in progress, unread regardless of input order', () => {
    const rows = [
      row({ attention: 'unread' }),
      row({ displayStatus: 'in_progress' }),
      row({ displayStatus: 'needs_attention' }),
      row({ displayStatus: 'blocked' }),
      row({ displayStatus: 'failed' }),
    ];
    expect(dockStatusGroups(rows).map((group) => group.status)).toEqual([
      'failed',
      'blocked',
      'needs_attention',
      'in_progress',
      'unread',
    ]);
  });

  it('uses the row badge status: a failed workspace with unread activity counts as failed only', () => {
    expect(dockStatusGroups([row({ displayStatus: 'failed', attention: 'unread' })])).toEqual([
      { status: 'failed', count: 1 },
    ]);
  });

  it('omits zero groups and statuses that are not updates', () => {
    const rows = [
      row({ displayStatus: 'complete' }),
      row({ displayStatus: 'idle', waiting: true }),
      row({ displayStatus: 'not_started' }),
    ];
    expect(dockStatusGroups(rows)).toEqual([]);
  });
});
