import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const {
  dismissMock,
  dispatchMock,
  generateReportMock,
  appStoreFactoryMock,
  selectCurrentWorkspaceMock,
  selectWorkspaceDefaultModelMock,
  toastCustomMock,
} = vi.hoisted(() => ({
  dismissMock: vi.fn(),
  dispatchMock: vi.fn(),
  generateReportMock: vi.fn(),
  appStoreFactoryMock: vi.fn(),
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

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => appStoreFactoryMock()?.getState?.() ?? {},
    dispatch: (...args: any[]) => appStoreFactoryMock()?.dispatch?.(...args),
  });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectWorkspaceDefaultModel: { select: selectWorkspaceDefaultModelMock },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
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
    appStoreFactoryMock.mockReturnValue({ getState: () => legacyState, dispatch: dispatchMock });
    selectCurrentWorkspaceMock.mockReturnValue({ id: 'ws-1' });
    selectWorkspaceDefaultModelMock.mockReturnValue('selector-workspace-model');
  });

  it('uses the workspace default selector when launching the debug agent', async () => {
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
    // Content-only component — the severity tint rides the wrapper class.
    expect(options.class).toBe('!border-destructive/50');
    await options.componentProps.onDebug();

    expect(selectWorkspaceDefaultModelMock).toHaveBeenCalledWith(legacyState, 'ws-1');
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceAgents/createAgentFromConfigRequested',
        payload: expect.arrayContaining([
          'ws-1',
          // 'Debug Agent' is a generated placeholder — the session must stay
          // self-renameable (nameExplicitlySet: false on the wire).
          expect.objectContaining({
            model: 'selector-workspace-model',
            name: 'Debug Agent',
            nameExplicitlySet: false,
          }),
          expect.objectContaining({ openAgent: true }),
        ]),
      }),
    );
    expect(dismissMock).toHaveBeenCalledWith('error-1');
  });
});