/**
 * Wire-contract tests for SetupScriptBanner (PROTOCOL §5.25).
 *
 * Asserts that the banner calls `workspace.getSetupScript` with the correct
 * `workspaceId` and hides when the daemon returns a non-empty script.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/svelte';

// Mock the backend transport
const { backendRequestMock, mockWorkspace, mockDismissed } = vi.hoisted(() => ({
  backendRequestMock: vi.fn(),
  mockWorkspace: { value: { id: 'ws-test', repositoryPath: '/test/repo' } as any },
  mockDismissed: { value: false },
}));

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: backendRequestMock,
  backendSubscribe: vi.fn(async () => ({ subscriptionId: 'sub-1' })),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
  detectLiveStateCapability: vi.fn(async () => false),
  isBackendAvailable: () => true,
  BackendError: class BackendError extends Error {},
}));

// Mock selectors
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: vi.fn(() => ({
    subscribe: (fn: (value: any) => void) => {
      fn(mockWorkspace.value);
      return () => {};
    },
  })),
}));

vi.mock('$store/renderer/slices/setup-scripts/setup-scripts-selectors', () => ({
  selectIsSetupScriptBannerDismissed: vi.fn(() => ({
    subscribe: (fn: (value: boolean) => void) => {
      fn(mockDismissed.value);
      return () => {};
    },
  })),
}));

// Mock appStore dispatch
vi.mock('$store/renderer/store', () => ({
  store: {
    dispatch: vi.fn(),
  },
}));

// Mock logger
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock terminal history tracker
vi.mock('$features/terminal/terminal-history-tracker', () => ({
  terminalHistoryTracker: {
    updateCounter: { subscribe: vi.fn(() => () => {}) },
    getHistoriesForWorkspace: vi.fn(() => []),
    getHistory: vi.fn(() => null),
  },
}));

// Mock CodeEditor component to avoid monaco-editor imports
vi.mock('$lib/components/editor/CodeEditor.svelte', () => ({
  default: vi.fn(),
}));

// Mock all FA icons
vi.mock('svelte-fa', () => ({
  default: vi.fn(),
}));

// Mock button component
vi.mock('$lib/components/ui/button', () => ({
  Button: vi.fn(),
}));

// Mock svelte transitions
vi.mock('svelte/transition', () => ({
  fly: () => ({}),
}));

// Mock svelte easing
vi.mock('svelte/easing', () => ({
  cubicOut: () => {},
}));

// Mock sonner toast
vi.mock('svelte-sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'mock-uuid',
}));

// Mock FA icons
vi.mock('@fortawesome/free-solid-svg-icons', () => ({
  faWandMagicSparkles: {},
  faXmark: {},
  faFloppyDisk: {},
  faChevronRight: {},
}));

import SetupScriptBanner from '../SetupScriptBanner.svelte';
import type { WorkspaceSetupScript } from '$lib/client/app-client';

describe('SetupScriptBanner wire contract', () => {
  beforeEach(() => {
    backendRequestMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls workspace.getSetupScript with workspaceId on mount', async () => {
    const scriptRecord: WorkspaceSetupScript = {
      script: '',
      projectType: null,
      updatedAt: Date.now(),
      generatedBy: null,
    };
    backendRequestMock.mockResolvedValue({ setupScript: scriptRecord });

    render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalledWith('workspace.getSetupScript', {
        workspaceId: 'ws-test',
      });
    });
  });

  it('hides the banner when the daemon returns a non-empty script', async () => {
    const scriptRecord: WorkspaceSetupScript = {
      script: '#!/bin/bash\necho "setup"\n',
      projectType: 'bash',
      updatedAt: Date.now(),
      generatedBy: 'agent',
    };
    backendRequestMock.mockResolvedValue({ setupScript: scriptRecord });

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Banner should not be visible
    expect(container.querySelector('.setup-script-banner')).toBeNull();
  });

  it('shows the banner when the daemon returns an empty script', async () => {
    const scriptRecord: WorkspaceSetupScript = {
      script: '',
      projectType: null,
      updatedAt: Date.now(),
      generatedBy: null,
    };
    backendRequestMock.mockResolvedValue({ setupScript: scriptRecord });

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Banner should be visible
    expect(container.querySelector('.setup-script-banner')).toBeTruthy();
  });

  it('shows the banner when the daemon returns null (no script)', async () => {
    backendRequestMock.mockResolvedValue({ setupScript: null });

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Banner should be visible
    expect(container.querySelector('.setup-script-banner')).toBeTruthy();
  });

  it('shows the banner on RPC failure (fallback behavior)', async () => {
    backendRequestMock.mockRejectedValue(new Error('connection failed'));

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Banner should be visible as fallback
    expect(container.querySelector('.setup-script-banner')).toBeTruthy();
  });
});
