import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  dismissMock,
  dispatchMock,
  generateReportMock,
  appStoreFactoryMock,
  selectWorkspaceByIdMock,
  selectCurrentWorkspaceTabIdMock,
  selectSelectedModelMock,
  toastCustomMock,
} = vi.hoisted(() => ({
  dismissMock: vi.fn(),
  dispatchMock: vi.fn(),
  generateReportMock: vi.fn(),
  appStoreFactoryMock: vi.fn(),
  selectWorkspaceByIdMock: vi.fn(),
  selectCurrentWorkspaceTabIdMock: vi.fn(),
  selectSelectedModelMock: vi.fn(),
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
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => appStoreFactoryMock()?.getState?.() ?? {},
    dispatch: (...args: any[]) => appStoreFactoryMock()?.dispatch?.(...args),
  });
});

vi.mock('$store/renderer/slices/model/model-selectors', () => ({
  selectSelectedModel: { select: selectSelectedModelMock },
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: { select: selectWorkspaceByIdMock },
}));

vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: { select: selectCurrentWorkspaceTabIdMock },
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
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    generateReportMock.mockReturnValue({ agentPrompt: 'diagnostic context' });
    appStoreFactoryMock.mockReturnValue({ getState: () => legacyState, dispatch: dispatchMock });
    selectWorkspaceByIdMock.mockReturnValue({ id: 'ws-1' });
    selectCurrentWorkspaceTabIdMock.mockReturnValue('ws-1');
    selectSelectedModelMock.mockReturnValue('selector-global-model');
  });

  it('uses the global selected model when launching the debug agent', async () => {
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

    expect(selectSelectedModelMock).toHaveBeenCalledWith(legacyState);
    expect(dispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'workspaceAgents/createAgentFromConfigRequested',
        payload: expect.arrayContaining([
          'ws-1',
          // 'Debug Agent' is a generated placeholder — the session must stay
          // self-renameable (nameExplicitlySet: false on the wire).
          expect.objectContaining({
            model: 'selector-global-model',
            name: 'Debug Agent',
            nameExplicitlySet: false,
          }),
          expect.objectContaining({ openAgent: true }),
        ]),
      }),
    );
    expect(dismissMock).toHaveBeenCalledWith('error-1');
  });

  // Content-only component — the severity tint rides the wrapper class.
  it.each([
    ['error', '!border-danger/50'],
    ['warning', '!border-warning/50'],
    ['info', '!border-info/50'],
  ])('passes the %s severity wrapper border class', (type, expectedClass) => {
    showErrorToast({
      id: `error-${type}`,
      title: 'Broken',
      message: 'Something went wrong',
      timestamp: new Date('2026-03-17T00:00:00.000Z'),
      type,
      recoverable: false,
    } as any);

    const [, options] = toastCustomMock.mock.calls[0];
    expect(options.class).toBe(expectedClass);
  });
});
