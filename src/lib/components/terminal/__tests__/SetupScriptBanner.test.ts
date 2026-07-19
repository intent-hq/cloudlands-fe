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
vi.mock('$lib/components/editor/CodeEditor.svelte', async () => {
  const { default: MockCodeEditor } = await import('./mocks/MockCodeEditor.svelte');
  return { default: MockCodeEditor };
});

// Mock all FA icons
vi.mock('svelte-fa', async () => {
  const { default: MockFa } = await import('./mocks/MockFa.svelte');
  return { default: MockFa };
});

// Mock button component
vi.mock('$lib/components/ui/button', async () => {
  const { default: MockButton } = await import('./mocks/MockButton.svelte');
  return { Button: MockButton };
});

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

    // Wait for request to complete and state to settle
    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Wait an additional tick for the effect to complete and DOM to update
    await new Promise((resolve) => setTimeout(resolve, 50));

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

    // Wait for request to complete and state to settle
    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Wait for the banner element to appear after the async effect completes
    await waitFor(() => {
      expect(container.querySelector('.setup-script-banner')).toBeTruthy();
    });
  });

  it('shows the banner when the daemon returns null (no script)', async () => {
    backendRequestMock.mockResolvedValue({ setupScript: null });

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    // Wait for request to complete
    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Wait for the banner element to appear after the async effect completes
    await waitFor(() => {
      expect(container.querySelector('.setup-script-banner')).toBeTruthy();
    });
  });

  it('shows the banner on RPC failure (fallback behavior)', async () => {
    backendRequestMock.mockRejectedValue(new Error('connection failed'));

    const { container } = render(SetupScriptBanner, { props: { workspaceId: 'ws-test' } });

    // Wait for request to complete (rejection)
    await waitFor(() => {
      expect(backendRequestMock).toHaveBeenCalled();
    });

    // Wait for the banner element to appear after the async effect handles the failure
    await waitFor(() => {
      expect(container.querySelector('.setup-script-banner')).toBeTruthy();
    });
  });
});
