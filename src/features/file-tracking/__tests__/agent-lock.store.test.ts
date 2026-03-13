import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  reduxDispatchMock,
  getReduxStoreMock,
  syncWorkspaceSettingsMock,
} = vi.hoisted(() => ({
  reduxDispatchMock: vi.fn(),
  getReduxStoreMock: vi.fn(),
  syncWorkspaceSettingsMock: vi.fn((workspaceId: string) => ({
    type: 'workspaceSettings/syncWorkspaceSettings',
    payload: [workspaceId],
  })),
}));

vi.mock('$features/agent/browser', () => ({
  unifiedStateStore: { currentWorkspace: null },
}));

vi.mock('$features/agent/agent.service', () => ({
  agentService: { getSession: vi.fn(() => null) },
}));

vi.mock('$features/notes/notes.store.svelte', () => ({
  notesStateManager: { findById: vi.fn(() => null) },
}));

vi.mock('../file-tracking.store.svelte', () => ({
  fileTrackingStore: {
    workingChanges: {
      unstaged: [],
      staged: [],
    },
  },
}));

vi.mock('$lib/store/slices/workspace-settings/workspace-settings-slice', () => ({
  syncWorkspaceSettings: syncWorkspaceSettingsMock,
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  dispatch: reduxDispatchMock,
  getReduxStore: getReduxStoreMock,
}));

import { createAgentLockStore } from '../agent-lock.store.svelte';

describe('createAgentLockStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not throw when Redux bridges are not initialized yet', () => {
    getReduxStoreMock.mockImplementation(() => {
      throw new Error('store bridge not initialized');
    });
    reduxDispatchMock.mockImplementation(() => {
      throw new Error('dispatch bridge not initialized');
    });

    expect(() => createAgentLockStore('ws-1')).not.toThrow();
    expect(syncWorkspaceSettingsMock).toHaveBeenCalledWith('ws-1');
    expect(reduxDispatchMock).toHaveBeenCalledWith({
      type: 'workspaceSettings/syncWorkspaceSettings',
      payload: ['ws-1'],
    });
  });
});