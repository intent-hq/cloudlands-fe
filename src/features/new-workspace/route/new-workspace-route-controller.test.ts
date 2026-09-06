import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceDraft } from '$shared/types';
import { reduce, type ControllerState } from '../controller';

const mocks = vi.hoisted(() => ({
  legacyGet: vi.fn(),
  legacyClear: vi.fn(),
  createDraft: vi.fn(),
  runnerOptions: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: {
    drafts: { get: mocks.legacyGet, clear: mocks.legacyClear },
    workspaceDrafts: { create: mocks.createDraft },
  },
}));

vi.mock('../effects', async () => {
  const actual = await vi.importActual<typeof import('../effects')>('../effects');
  return {
    ...actual,
    createDraftTransactionRunner: (options: unknown) => {
      mocks.runnerOptions(options);
      let state: ControllerState;
      let listener: (next: ControllerState) => void = () => undefined;
      return {
        start(initial: ControllerState) {
          state = initial;
          listener(state);
        },
        dispatch(event: Parameters<typeof reduce>[1]) {
          state = reduce(state, event);
          listener(state);
        },
        subscribe(next: (value: ControllerState) => void) {
          listener = next;
          return () => undefined;
        },
        stop: vi.fn(),
      };
    },
  };
});

import { createNewWorkspaceRouteController } from './new-workspace-route-controller';
import { requestedDraftIdForRoute } from './new-workspace-navigation';

const draft = (overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft => ({
  id: 'draft-1',
  ownerClientId: 'client-1',
  revision: 1,
  phase: 'editing',
  intentText: 'Build it',
  source: null,
  contextLinks: [],
  attachments: [],
  config: {},
  operationKey: 'operation-1',
  delivery: { state: 'none' },
  createdAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

describe('new workspace route controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.legacyGet.mockResolvedValue(null);
  });

  it('exposes stable draft-created, first-input, promote-started, and live transitions', async () => {
    const controller = createNewWorkspaceRouteController({
      startInput: {},
      requestedDraftId: null,
    });
    const observed: ControllerState[] = [];
    await controller.start((state) => observed.push(state));
    controller.dispatch({ type: 'backend.connected', generation: 1, ownerClientId: 'client-1' });
    controller.edit({ intentText: 'Build it' });
    controller.dispatch({
      type: 'draft.acknowledged',
      generation: 1,
      inputVersion: 1,
      draft: draft(),
    });
    controller.dispatch({
      type: 'capability.result',
      generation: 1,
      capability: 'provider',
      status: 'ready',
    });
    controller.dispatch({ type: 'start.requested', requiredCapabilities: ['provider'] });
    controller.dispatch({
      type: 'promote.ack',
      generation: 1,
      operationKey: 'operation-1',
      draft: draft({ phase: 'promoted', promotedWorkspaceId: 'workspace-1' }),
      workspaceId: 'workspace-1',
    });
    controller.dispatch({ type: 'adoption.completed', generation: 1, pendingAttachmentIds: [] });
    controller.dispatch({
      type: 'delivery.reconciled',
      generation: 1,
      delivery: { state: 'sent', messageId: 'message-1' },
    });

    expect(observed.find((state) => state.draftId === 'draft-1')).toBeDefined();
    expect(observed.find((state) => state.phase === 'editing')?.input.intentText).toBe('Build it');
    expect(observed.some((state) => state.phase === 'promoting')).toBe(true);
    expect(observed.at(-1)).toMatchObject({ phase: 'live', workspaceId: 'workspace-1' });
  });

  it('imports a legacy sentinel draft once before starting the durable runner', async () => {
    mocks.legacyGet.mockResolvedValue({ text: 'Legacy prompt', attachments: [] });
    mocks.createDraft.mockResolvedValue(
      draft({ id: 'migrated-draft', intentText: 'Legacy prompt' }),
    );
    const controller = createNewWorkspaceRouteController({
      startInput: {},
      requestedDraftId: undefined,
    });

    await controller.start(() => undefined);

    expect(mocks.createDraft).toHaveBeenCalledWith({
      intentText: 'Legacy prompt',
      attachments: [],
    });
    expect(mocks.legacyClear).toHaveBeenCalledWith('__new-workspace__', '__initializer__');
    expect(mocks.runnerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ requestedDraftId: 'migrated-draft' }),
    );
  });

  it('restores the newest owned draft when the route has no draft selector', async () => {
    const controller = createNewWorkspaceRouteController({
      startInput: {},
      requestedDraftId: requestedDraftIdForRoute(new URL('https://intent.test/workspace/new')),
    });

    await controller.start(() => undefined);

    expect(mocks.runnerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ requestedDraftId: undefined }),
    );
  });

  it('forces a fresh draft for an explicit new-workspace instance', async () => {
    const controller = createNewWorkspaceRouteController({
      startInput: {},
      requestedDraftId: requestedDraftIdForRoute(
        new URL('https://intent.test/workspace/new?instance=instance-1'),
      ),
    });

    await controller.start(() => undefined);

    expect(mocks.runnerOptions).toHaveBeenCalledWith(
      expect.objectContaining({ requestedDraftId: null }),
    );
    expect(mocks.legacyGet).not.toHaveBeenCalled();
  });

  it('keeps two new drafts in one client independently addressed without identity swap', async () => {
    const first = createNewWorkspaceRouteController({
      startInput: { text: 'First' },
      requestedDraftId: null,
    });
    const second = createNewWorkspaceRouteController({
      startInput: { text: 'Second' },
      requestedDraftId: null,
    });
    let firstState: ControllerState | undefined;
    let secondState: ControllerState | undefined;
    await first.start((state) => (firstState = state));
    await second.start((state) => (secondState = state));
    first.dispatch({ type: 'backend.connected', generation: 1, ownerClientId: 'client-1' });
    second.dispatch({ type: 'backend.connected', generation: 1, ownerClientId: 'client-1' });
    first.dispatch({
      type: 'draft.acknowledged',
      generation: 1,
      inputVersion: 0,
      draft: draft({ id: 'draft-first', operationKey: 'operation-first', intentText: 'First' }),
    });
    second.dispatch({
      type: 'draft.acknowledged',
      generation: 1,
      inputVersion: 0,
      draft: draft({ id: 'draft-second', operationKey: 'operation-second', intentText: 'Second' }),
    });

    expect(firstState).toMatchObject({ draftId: 'draft-first', input: { intentText: 'First' } });
    expect(secondState).toMatchObject({ draftId: 'draft-second', input: { intentText: 'Second' } });
    expect(mocks.runnerOptions).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestedDraftId: null }),
    );
    expect(mocks.runnerOptions).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestedDraftId: null }),
    );
  });
});
