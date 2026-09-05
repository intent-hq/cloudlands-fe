import { describe, expect, it } from 'vitest';

import type { WorkspaceDraft } from '$shared/types';

import {
  CONTROLLER_EVENT_TYPES,
  CONTROLLER_PHASES,
  createInitialControllerState,
  effectsFor,
  hasUnsavedInput,
  reduce,
  reduceDetailed,
  type ControllerEvent,
  type ControllerEventType,
  type ControllerState,
} from '.';

const GENERATION = 7;

function draft(overrides: Partial<WorkspaceDraft> = {}): WorkspaceDraft {
  return {
    id: 'draft-1',
    ownerClientId: 'client-1',
    revision: 1,
    phase: 'editing',
    intentText: '',
    source: null,
    contextLinks: [],
    attachments: [],
    config: {},
    operationKey: 'operation-1',
    delivery: { state: 'none' },
    createdAt: '2026-09-04T20:00:00.000Z',
    updatedAt: '2026-09-04T20:00:00.000Z',
    ...overrides,
  };
}

function restore(remote = draft()): ControllerState {
  let state: ControllerState = createInitialControllerState(GENERATION);
  state = reduce(state, {
    type: 'backend.connected',
    generation: GENERATION,
    draftId: remote.id,
  });
  return reduce(state, { type: 'restore.succeeded', generation: GENERATION, draft: remote });
}

function promoting(): ControllerState {
  let state = restore(draft({ intentText: 'Ship the change' }));
  state = reduce(state, { type: 'start.requested', requiredCapabilities: ['provider'] });
  return reduce(state, {
    type: 'capability.result',
    generation: GENERATION,
    capability: 'provider',
    status: 'ready',
  });
}

function adoptingState(): ControllerState {
  const state = promoting();
  expect(state.phase).toBe('promoting');
  return reduce(state, {
    type: 'promote.ack',
    generation: GENERATION,
    operationKey: 'operation-1',
    draft: draft({
      revision: 2,
      phase: 'promoted',
      intentText: 'Ship the change',
      promotedWorkspaceId: 'workspace-1',
      initialAgentId: 'agent-1',
    }),
    workspaceId: 'workspace-1',
    initialAgentId: 'agent-1',
  });
}

function sendingState(): ControllerState {
  return reduce(adoptingState(), {
    type: 'adoption.completed',
    generation: GENERATION,
    pendingAttachmentIds: [],
  });
}

function sampleEvent(type: ControllerEventType): ControllerEvent {
  switch (type) {
    case 'backend.connected':
      return { type, generation: GENERATION, draftId: 'draft-1' };
    case 'backend.switched':
      return { type, generation: GENERATION + 1 };
    case 'restore.succeeded':
      return { type, generation: GENERATION, draft: draft() };
    case 'restore.missing':
      return { type, generation: GENERATION };
    case 'user.edited':
      return { type, patch: { intentText: 'edited' } };
    case 'draft.createIssued':
    case 'draft.saveIssued':
      return { type, inputVersion: 0 };
    case 'draft.acknowledged':
      return { type, generation: GENERATION, inputVersion: 0, draft: draft() };
    case 'draft.updated':
      return { type, generation: GENERATION, draft: draft({ revision: 2 }) };
    case 'draft.conflict':
      return { type, generation: GENERATION, remote: draft({ revision: 2 }) };
    case 'draft.promoted':
      return {
        type,
        generation: GENERATION,
        draftId: 'draft-1',
        workspaceId: 'workspace-1',
      };
    case 'draft.deleted':
      return { type, generation: GENERATION, draftId: 'draft-1' };
    case 'capabilities.recheckRequested':
      return { type, capabilities: ['git', 'node', 'github'] };
    case 'capability.result':
      return { type, generation: GENERATION, capability: 'provider', status: 'ready' };
    case 'start.requested':
      return { type, requiredCapabilities: ['provider'] };
    case 'promote.issued':
      return { type, operationKey: 'operation-1' };
    case 'promote.ack':
      return {
        type,
        generation: GENERATION,
        operationKey: 'operation-1',
        draft: draft({ phase: 'promoted', promotedWorkspaceId: 'workspace-1' }),
        workspaceId: 'workspace-1',
      };
    case 'promote.ackLost':
      return { type, generation: GENERATION, operationKey: 'operation-1' };
    case 'adoption.completed':
      return { type, generation: GENERATION, pendingAttachmentIds: [] };
    case 'attachments.placed':
      return { type, generation: GENERATION, placedIds: [], failures: [] };
    case 'delivery.reconcileIssued':
    case 'send.issued':
    case 'daemon.offline':
    case 'reconnect':
    case 'retry':
    case 'conflict.acceptRemote':
    case 'conflict.keepLocal':
      return { type };
    case 'delivery.reconciled':
      return { type, generation: GENERATION, delivery: { state: 'none' } };
    case 'send.ack':
      return { type, generation: GENERATION, messageId: 'message-1' };
    case 'send.unknown':
      return { type, generation: GENERATION };
    case 'operation.failed':
      return { type, generation: GENERATION, kind: 'send', error: 'failed' };
  }
}

function representativeStates(): ControllerState[] {
  const boot = createInitialControllerState(GENERATION);
  const restoring = reduce(boot, {
    type: 'backend.connected',
    generation: GENERATION,
    draftId: 'draft-1',
  });
  const pristine = restore();
  const editing = restore(draft({ intentText: 'Ship the change' }));
  const starting = reduce(editing, {
    type: 'start.requested',
    requiredCapabilities: ['provider'],
  });
  const promote = promoting();
  const adopting = adoptingState();
  const placingAttachments = reduce(adopting, {
    type: 'adoption.completed',
    generation: GENERATION,
    pendingAttachmentIds: ['attachment-1'],
  });
  const sending = sendingState();
  const live = reduce(reduce(sending, { type: 'delivery.reconcileIssued' }), {
    type: 'delivery.reconciled',
    generation: GENERATION,
    delivery: { state: 'sent', messageId: 'message-1' },
  });
  const failed = reduce(editing, {
    type: 'operation.failed',
    generation: GENERATION,
    kind: 'draft',
    error: 'save failed',
  });
  const offline = reduce(editing, { type: 'daemon.offline' });
  const conflict = reduce(editing, {
    type: 'draft.conflict',
    generation: GENERATION,
    remote: draft({ revision: 2, intentText: 'remote' }),
  });
  return [
    boot,
    restoring,
    pristine,
    editing,
    starting,
    promote,
    adopting,
    placingAttachments,
    sending,
    live,
    failed,
    offline,
    conflict,
  ];
}

describe('new-workspace controller', () => {
  it('classifies every state and event pair as handled or explicitly ignored', () => {
    const states = representativeStates();
    expect(states.map(({ phase }) => phase)).toEqual(CONTROLLER_PHASES);

    for (const state of states) {
      for (const eventType of CONTROLLER_EVENT_TYPES) {
        const transition = reduceDetailed(state, sampleEvent(eventType));
        expect(['handled', 'ignored']).toContain(transition.disposition);
        if (transition.disposition === 'ignored') expect(transition.state).toBe(state);
      }
    }
  });

  it('keeps input stable while pending, missing, unknown, and ready probes settle', () => {
    let state = restore(draft({ intentText: 'Never clear this' }));
    state = reduce(state, {
      type: 'start.requested',
      requiredCapabilities: ['provider', 'git'],
    });
    expect(state.phase).toBe('starting');
    expect(state.capabilities).toMatchObject({ provider: 'pending', git: 'pending' });

    for (const [capability, status] of [
      ['provider', 'missing'],
      ['provider', 'unknown'],
      ['provider', 'pending'],
      ['provider', 'ready'],
      ['git', 'ready'],
    ] as const) {
      state = reduce(state, {
        type: 'capability.result',
        generation: GENERATION,
        capability,
        status,
      });
      expect(state.input.intentText).toBe('Never clear this');
    }
    expect(state.phase).toBe('promoting');
  });

  it('rechecks host capabilities after PATH changes without touching acknowledged input', () => {
    let state = restore(draft({ intentText: 'Keep this', attachments: [{ id: 'file-1' }] }));
    state = reduce(state, {
      type: 'capabilities.recheckRequested',
      capabilities: ['git', 'node', 'github'],
    });

    expect(effectsFor(state)).toEqual([
      { type: 'probeCapability', generation: GENERATION, capability: 'git' },
      { type: 'probeCapability', generation: GENERATION, capability: 'node' },
      { type: 'probeCapability', generation: GENERATION, capability: 'github' },
    ]);
    expect(state.input).toMatchObject({ intentText: 'Keep this', attachments: [{ id: 'file-1' }] });
    expect(hasUnsavedInput(state)).toBe(false);
  });

  it('rejects late async results from the previous backend generation', () => {
    let state = restore(draft({ intentText: 'Keep local input' }));
    state = reduce(state, { type: 'user.edited', patch: { intentText: 'Typed locally' } });
    state = reduce(state, { type: 'backend.switched', generation: GENERATION + 1 });
    expect(state.phase).toBe('boot');
    expect(state.input.intentText).toBe('Typed locally');

    const transition = reduceDetailed(state, {
      type: 'draft.updated',
      generation: GENERATION,
      draft: draft({ revision: 99, intentText: 'stale backend' }),
    });
    expect(transition.disposition).toBe('ignored');
    expect(transition.state).toBe(state);
  });

  it('issues promotion once and reconciles rather than re-promoting after ACK loss', () => {
    let state = promoting();
    expect(effectsFor(state)).toEqual([
      expect.objectContaining({ type: 'promoteDraft', operationKey: 'operation-1' }),
    ]);

    state = reduce(state, { type: 'promote.issued', operationKey: 'operation-1' });
    expect(effectsFor(state)).toEqual([]);
    state = reduce(state, {
      type: 'promote.ackLost',
      generation: GENERATION,
      operationKey: 'operation-1',
    });
    expect(effectsFor(state)).toEqual([
      expect.objectContaining({ type: 'reconcilePromotion', operationKey: 'operation-1' }),
    ]);
    expect(
      reduceDetailed(state, { type: 'promote.issued', operationKey: 'operation-1' }).disposition,
    ).toBe('ignored');
  });

  it('reissues a send only after delivery reconciliation proves it absent', () => {
    let state = sendingState();
    expect(effectsFor(state).map(({ type }) => type)).toEqual(['reconcileDelivery']);
    state = reduce(state, { type: 'delivery.reconcileIssued' });
    expect(effectsFor(state)).toEqual([]);
    state = reduce(state, {
      type: 'delivery.reconciled',
      generation: GENERATION,
      delivery: { state: 'none' },
    });
    expect(effectsFor(state).map(({ type }) => type)).toEqual(['sendFirstMessage']);
    state = reduce(state, { type: 'send.issued' });
    expect(effectsFor(state)).toEqual([]);
    state = reduce(state, { type: 'send.unknown', generation: GENERATION });
    expect(effectsFor(state).map(({ type }) => type)).toEqual(['reconcileDelivery']);
    state = reduce(state, {
      type: 'delivery.reconciled',
      generation: GENERATION,
      delivery: { state: 'none' },
    });
    expect(effectsFor(state).map(({ type }) => type)).toEqual(['sendFirstMessage']);
  });

  it('derives unsaved state from the last acknowledged draft revision payload', () => {
    let state = restore(draft({ intentText: 'saved' }));
    expect(hasUnsavedInput(state)).toBe(false);
    state = reduce(state, { type: 'user.edited', patch: { intentText: 'first edit' } });
    const firstVersion = state.inputVersion;
    state = reduce(state, { type: 'draft.saveIssued', inputVersion: firstVersion });
    state = reduce(state, { type: 'user.edited', patch: { intentText: 'typed ahead' } });
    state = reduce(state, {
      type: 'draft.acknowledged',
      generation: GENERATION,
      inputVersion: firstVersion,
      draft: draft({ revision: 2, intentText: 'first edit' }),
    });
    expect(state.input.intentText).toBe('typed ahead');
    expect(hasUnsavedInput(state)).toBe(true);

    state = reduce(state, {
      type: 'draft.acknowledged',
      generation: GENERATION,
      inputVersion: state.inputVersion,
      draft: draft({ revision: 3, intentText: 'typed ahead' }),
    });
    expect(hasUnsavedInput(state)).toBe(false);
  });

  it('surfaces revision conflicts and can keep local input against the remote revision', () => {
    let state = restore(draft({ intentText: 'base' }));
    state = reduce(state, { type: 'user.edited', patch: { intentText: 'local' } });
    state = reduce(state, {
      type: 'draft.updated',
      generation: GENERATION,
      draft: draft({ revision: 2, intentText: 'remote' }),
    });
    expect(state.phase).toBe('conflict');

    state = reduce(state, { type: 'conflict.keepLocal' });
    expect(state.phase).toBe('editing');
    expect(state.input.intentText).toBe('local');
    expect(hasUnsavedInput(state)).toBe(true);
    expect(effectsFor(state)).toEqual([
      expect.objectContaining({ type: 'updateDraft', expectedRevision: 2 }),
    ]);
  });

  it('retains offline typing through reconnect and authoritative restoration', () => {
    let state = restore(draft({ intentText: 'saved' }));
    state = reduce(state, { type: 'daemon.offline' });
    state = reduce(state, { type: 'user.edited', patch: { intentText: 'typed offline' } });
    expect(state.phase).toBe('offline');
    expect(state.phase === 'offline' && state.unsavedInput.intentText).toBe('typed offline');

    state = reduce(state, { type: 'reconnect' });
    state = reduce(state, {
      type: 'backend.connected',
      generation: GENERATION,
      draftId: 'draft-1',
    });
    state = reduce(state, {
      type: 'restore.succeeded',
      generation: GENERATION,
      draft: draft({ revision: 2, intentText: 'saved remotely' }),
    });
    expect(state.phase).toBe('editing');
    expect(state.input.intentText).toBe('typed offline');
    expect(hasUnsavedInput(state)).toBe(true);
  });

  it.each([
    ['pristine', draft(), 'pristine', undefined],
    ['editing', draft({ intentText: 'task' }), 'editing', undefined],
    ['starting', draft({ intentText: 'task' }), 'editing', undefined],
    [
      'promoting',
      draft({ phase: 'promoting', intentText: 'task' }),
      'promoting',
      'reconcilePromotion',
    ],
    [
      'failed',
      draft({ phase: 'failed', intentText: 'task', promotedWorkspaceId: 'workspace-1' }),
      'promoting',
      'reconcilePromotion',
    ],
    [
      'adopting',
      draft({ phase: 'promoted', intentText: 'task', promotedWorkspaceId: 'workspace-1' }),
      'adopting',
      'adoptWorkspace',
    ],
    [
      'placingAttachments',
      draft({ phase: 'promoted', intentText: 'task', promotedWorkspaceId: 'workspace-1' }),
      'adopting',
      'adoptWorkspace',
    ],
    [
      'sending',
      draft({ phase: 'promoted', intentText: 'task', promotedWorkspaceId: 'workspace-1' }),
      'adopting',
      'adoptWorkspace',
    ],
    [
      'live',
      draft({
        phase: 'promoted',
        intentText: 'task',
        promotedWorkspaceId: 'workspace-1',
        delivery: { state: 'sent', messageId: 'message-1' },
      }),
      'adopting',
      'adoptWorkspace',
    ],
  ] as const)(
    'restores safely after restart at the %s boundary',
    (_boundary, remote, expectedPhase, expectedEffect) => {
      const state = restore(remote);
      expect(state.phase).toBe(expectedPhase);
      const effectTypes = effectsFor(state).map(({ type }) => type);
      if (expectedEffect) expect(effectTypes).toEqual([expectedEffect]);
      else expect(effectTypes).not.toContain('promoteDraft');
      expect(effectTypes).not.toContain('sendFirstMessage');
    },
  );

  it('retries only failed attachment placements', () => {
    let state = reduce(adoptingState(), {
      type: 'adoption.completed',
      generation: GENERATION,
      pendingAttachmentIds: ['a', 'b'],
    });
    state = reduce(state, {
      type: 'attachments.placed',
      generation: GENERATION,
      placedIds: ['a'],
      failures: [{ id: 'b', error: 'missing file' }],
    });
    expect(state.phase).toBe('failed');
    state = reduce(state, { type: 'retry' });
    expect(state.phase).toBe('placingAttachments');
    expect(effectsFor(state)).toEqual([
      expect.objectContaining({ type: 'placeAttachments', attachmentIds: ['b'] }),
    ]);
  });
});
