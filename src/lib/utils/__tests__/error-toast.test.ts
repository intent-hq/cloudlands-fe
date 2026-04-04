import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createAgentMock,
  dismissMock,
  generateReportMock,
  getInstanceMock,
  getReduxStoreMock,
  selectCurrentWorkspaceMock,
  selectWorkspaceDefaultModelMock,
  toastCustomMock,
} = vi.hoisted(() => ({
  createAgentMock: vi.fn(),
  dismissMock: vi.fn(),
  generateReportMock: vi.fn(),
  getInstanceMock: vi.fn(),
  getReduxStoreMock: vi.fn(),
  selectCurrentWorkspaceMock: vi.fn(),
  selectWorkspaceDefaultModelMock: vi.fn(),
  toastCustomMock: vi.fn(),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: {
    custom: toastCustomMock,
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('$lib/components/ui/toast/ErrorToast.svelte', () => ({
  default: 'ErrorToast',
}));

vi.mock('$lib/store/redux-dispatch-bridge', () => ({
  getReduxStore: getReduxStoreMock,
}));

vi.mock('$lib/store/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: { select: selectWorkspaceDefaultModelMock },
}));

vi.mock('$lib/store/slices/workspace/workspace-selectors', () => ({
  selectCurrentWorkspace: { select: selectCurrentWorkspaceMock },
}));

vi.mock('$lib/utils/error-handler.svelte', () => ({
  errorHandler: {
    attemptRecovery: vi.fn(),
    dismiss: dismissMock,
  },
}));

vi.mock('$lib/utils/error-reporter', () => ({
  errorReporter: { generateReport: generateReportMock },
}));

vi.mock('$features/agent/services/agent-factory', () => ({
  UnifiedAgentFactory: { getInstance: getInstanceMock },
}));

import { showErrorToast } from '../error-toast';

describe('showErrorToast', () => {
  const legacyState = {
    model: {
      selectedModel: 'legacy-global-model',
      workspaceModels: { 'ws-1': 'legacy-workspace-model' },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    generateReportMock.mockReturnValue({ agentPrompt: 'diagnostic context' });
    getInstanceMock.mockReturnValue({ createAgent: createAgentMock });
    getReduxStoreMock.mockReturnValue({ getState: () => legacyState });
    selectCurrentWorkspaceMock.mockReturnValue({ id: 'ws-1' });
    selectWorkspaceDefaultModelMock.mockReturnValue('selector-workspace-model');
    createAgentMock.mockResolvedValue({ agentId: 'agent-123' });
  });

  it('uses the workspace default selector when launching the debug agent', async () => {
    const dispatchEventSpy = vi.spyOn(window, 'dispatchEvent');
    const error = {
      id: 'error-1',
      title: 'Broken',
      message: 'Something went wrong',
      timestamp: new Date('2026-03-17T00:00:00.000Z'),
      type: 'error',
      recoverable: true,
    } as any;

    showErrorToast(error);

    const [, options] = toastCustomMock.mock.calls[0];
    await options.componentProps.onDebug();

    expect(selectWorkspaceDefaultModelMock).toHaveBeenCalledWith(legacyState, 'ws-1');
    expect(createAgentMock).toHaveBeenCalledWith(
      { id: 'ws-1' },
      expect.objectContaining({ model: 'selector-workspace-model' }),
    );
    expect(createAgentMock.mock.calls[0][1].model).not.toBe(
      legacyState.model.workspaceModels['ws-1'],
    );
    expect(dismissMock).toHaveBeenCalledWith('error-1');
    expect(dispatchEventSpy).toHaveBeenCalled();
  });
});