import type { WorkspaceDraft } from '$shared/types';

import {
  createInitialControllerState,
  type AdoptingState,
  type ControllerData,
  type ControllerEvent,
  type ControllerState,
  type ControllerTransition,
  type DraftInput,
  type EditingState,
  type FailedState,
  type PlacingAttachmentsState,
  type PristineState,
  type PromotingState,
  type RecoverableState,
  type SendingState,
  type StartingState,
} from './types';

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => equalJson(value, right[index]))
    );
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord);
    const rightKeys = Object.keys(rightRecord);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) => Object.hasOwn(rightRecord, key) && equalJson(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

function inputFromDraft(draft: WorkspaceDraft): DraftInput {
  return {
    ...(draft.title === undefined ? {} : { title: draft.title }),
    intentText: draft.intentText,
    source: draft.source,
    contextLinks: draft.contextLinks,
    attachments: draft.attachments,
    config: draft.config,
  };
}

function isPristine(input: DraftInput): boolean {
  return (
    input.title === undefined &&
    input.intentText.length === 0 &&
    input.source === null &&
    input.contextLinks.length === 0 &&
    input.attachments.length === 0 &&
    Object.keys(input.config).length === 0
  );
}

export function hasUnsavedInput(
  state: Pick<ControllerData, 'input' | 'acknowledgedInput'>,
): boolean {
  return state.acknowledgedInput === null
    ? !isPristine(state.input)
    : !equalJson(state.input, state.acknowledgedInput);
}

function ignored(state: ControllerState): ControllerTransition {
  return { state, disposition: 'ignored' };
}

function handled(state: ControllerState): ControllerTransition {
  return { state, disposition: 'handled' };
}

function acknowledge(
  state: ControllerState,
  draft: WorkspaceDraft,
  preserveInput: boolean,
): ControllerData {
  const acknowledgedInput = inputFromDraft(draft);
  return {
    ...state,
    draftId: draft.id,
    draft,
    input: preserveInput ? state.input : acknowledgedInput,
    acknowledgedInput,
    acknowledgedRevision: draft.revision,
    saveInFlightVersion: null,
    creationIssued: true,
    workspaceId: draft.promotedWorkspaceId ?? state.workspaceId,
    initialAgentId: draft.initialAgentId ?? state.initialAgentId,
  };
}

function editable(data: ControllerData): EditingState | PristineState {
  return isPristine(data.input) ? { ...data, phase: 'pristine' } : { ...data, phase: 'editing' };
}

function advanceStarting(state: StartingState): StartingState | PromotingState {
  if (
    !state.draft ||
    hasUnsavedInput(state) ||
    !Object.keys(state.requiredCapabilities).every(
      (capability) => state.capabilities[capability as keyof typeof state.capabilities] === 'ready',
    )
  ) {
    return state;
  }
  return {
    ...state,
    phase: 'promoting',
    operationKey: state.draft.operationKey,
    promoteAttempt: 'not-issued',
  };
}

function adopting(
  state: ControllerState,
  workspaceId: string,
  initialAgentId?: string,
  draft?: WorkspaceDraft,
): AdoptingState {
  const data = draft ? acknowledge(state, draft, false) : state;
  return {
    ...data,
    phase: 'adopting',
    workspaceId,
    initialAgentId: initialAgentId ?? data.initialAgentId,
  };
}

function needsDelivery(input: DraftInput): boolean {
  return input.intentText.trim().length > 0 || input.attachments.length > 0;
}

function afterAttachments(
  state: AdoptingState | PlacingAttachmentsState,
): SendingState | ControllerState {
  if (!needsDelivery(state.input) || state.draft?.delivery.state === 'sent') {
    return { ...state, phase: 'live', workspaceId: state.workspaceId };
  }
  return {
    ...state,
    phase: 'sending',
    workspaceId: state.workspaceId,
    deliveryStage: 'needs-reconcile',
  };
}

function recoverableForFailure(state: ControllerState): RecoverableState | null {
  switch (state.phase) {
    case 'restoring':
    case 'pristine':
    case 'editing':
    case 'starting':
    case 'adopting':
    case 'placingAttachments':
      return state;
    case 'promoting':
      return state.promoteAttempt === 'not-issued'
        ? state
        : { ...state, promoteAttempt: 'ack-lost' };
    case 'sending':
      return state.deliveryStage === 'issued' ? { ...state, deliveryStage: 'unknown' } : state;
    case 'boot':
    case 'live':
    case 'failed':
    case 'offline':
    case 'conflict':
      return null;
  }
}

function failed(
  state: ControllerState,
  kind: FailedState['kind'],
  error: string,
  retryState = recoverableForFailure(state),
): FailedState {
  return { ...state, phase: 'failed', kind, error, retryState };
}

function editData(state: ControllerState, patch: Partial<DraftInput>): ControllerData {
  return {
    ...state,
    input: { ...state.input, ...patch },
    inputVersion: state.inputVersion + 1,
  };
}

function withData<State extends ControllerState>(state: State, data: ControllerData): State {
  return {
    ...state,
    generation: data.generation,
    draftId: data.draftId,
    draft: data.draft,
    input: data.input,
    inputVersion: data.inputVersion,
    acknowledgedInput: data.acknowledgedInput,
    acknowledgedRevision: data.acknowledgedRevision,
    saveInFlightVersion: data.saveInFlightVersion,
    creationIssued: data.creationIssued,
    capabilities: data.capabilities,
    workspaceId: data.workspaceId,
    initialAgentId: data.initialAgentId,
  };
}

function restoreDraft(state: ControllerState, draft: WorkspaceDraft): ControllerState {
  const preserveInput = hasUnsavedInput(state);
  const data = acknowledge(state, draft, preserveInput);
  if (draft.phase === 'promoted') {
    return draft.promotedWorkspaceId
      ? adopting(data as ControllerState, draft.promotedWorkspaceId, draft.initialAgentId, draft)
      : failed(
          data as ControllerState,
          'draft',
          draft.lastError ?? 'Promoted draft has no workspace',
        );
  }
  if (draft.phase === 'promoting') {
    return {
      ...data,
      phase: 'promoting',
      operationKey: draft.operationKey,
      promoteAttempt: 'ack-lost',
    };
  }
  if (draft.phase === 'failed') {
    const retryState = editable({ ...data, input: preserveInput ? state.input : data.input });
    return failed(
      data as ControllerState,
      'draft',
      draft.lastError ?? 'Draft operation failed',
      retryState,
    );
  }
  return editable(data);
}

function updateCapability(
  state: ControllerState,
  event: Extract<ControllerEvent, { type: 'capability.result' }>,
): ControllerState {
  const updated = {
    ...state,
    capabilities: { ...state.capabilities, [event.capability]: event.status },
  };
  return updated.phase === 'starting' ? advanceStarting(updated) : updated;
}

function switchBackend(state: ControllerState, generation: number): ControllerState {
  const next = createInitialControllerState(generation, state.input);
  return { ...next, inputVersion: state.inputVersion };
}

export function reduceDetailed(
  state: ControllerState,
  event: ControllerEvent,
): ControllerTransition {
  if (event.type === 'backend.switched') {
    return event.generation === state.generation
      ? ignored(state)
      : handled(switchBackend(state, event.generation));
  }
  if ('generation' in event && event.generation !== state.generation) return ignored(state);

  switch (event.type) {
    case 'backend.connected':
      if (state.phase !== 'boot') return ignored(state);
      return handled(
        event.draftId
          ? { ...state, phase: 'restoring', draftId: event.draftId }
          : { ...state, phase: isPristine(state.input) ? 'pristine' : 'editing' },
      );
    case 'restore.succeeded':
      return state.phase === 'restoring'
        ? handled(restoreDraft(state, event.draft))
        : ignored(state);
    case 'restore.missing':
      return state.phase === 'restoring'
        ? handled(editable({ ...state, draftId: null, draft: null, creationIssued: false }))
        : ignored(state);
    case 'user.edited': {
      const data = editData(state, event.patch);
      switch (state.phase) {
        case 'boot':
        case 'restoring':
          return handled({ ...state, ...data });
        case 'pristine':
        case 'editing':
          return handled({ ...data, phase: 'editing' });
        case 'starting':
          return handled({ ...state, ...data });
        case 'offline':
          return handled({ ...state, ...data, unsavedInput: data.input });
        case 'conflict':
          return handled({ ...state, ...data });
        case 'failed':
          return state.retryState
            ? handled({
                ...state,
                ...data,
                retryState: withData(state.retryState, data),
              })
            : ignored(state);
        case 'promoting':
        case 'adopting':
        case 'placingAttachments':
        case 'sending':
        case 'live':
          return ignored(state);
      }
    }
    case 'draft.createIssued':
      return (state.phase === 'pristine' || state.phase === 'editing') &&
        !state.draft &&
        event.inputVersion === state.inputVersion
        ? handled({ ...state, creationIssued: true })
        : ignored(state);
    case 'draft.saveIssued':
      return (state.phase === 'pristine' ||
        state.phase === 'editing' ||
        state.phase === 'starting') &&
        state.draft !== null &&
        event.inputVersion === state.inputVersion
        ? handled({ ...state, saveInFlightVersion: event.inputVersion })
        : ignored(state);
    case 'draft.acknowledged': {
      if (state.phase !== 'pristine' && state.phase !== 'editing' && state.phase !== 'starting') {
        return ignored(state);
      }
      const preserveInput = state.inputVersion !== event.inputVersion;
      const data = acknowledge(state, event.draft, preserveInput);
      if (state.phase === 'starting') {
        return handled(advanceStarting({ ...state, ...data }));
      }
      return handled(editable(data));
    }
    case 'draft.updated': {
      if (state.draftId !== event.draft.id && state.draft?.id !== event.draft.id) {
        return ignored(state);
      }
      if (
        hasUnsavedInput(state) &&
        state.acknowledgedRevision !== null &&
        event.draft.revision > state.acknowledgedRevision
      ) {
        return handled({ ...state, phase: 'conflict', remote: event.draft });
      }
      const data = acknowledge(state, event.draft, hasUnsavedInput(state));
      if (state.phase === 'pristine' || state.phase === 'editing') return handled(editable(data));
      if (state.phase === 'starting') return handled(advanceStarting({ ...state, ...data }));
      return handled(withData(state, data));
    }
    case 'draft.conflict':
      return state.phase === 'editing' || state.phase === 'starting'
        ? handled({ ...state, phase: 'conflict', remote: event.remote })
        : ignored(state);
    case 'draft.promoted':
      return state.draftId === event.draftId && state.phase !== 'live'
        ? handled(adopting(state, event.workspaceId, event.initialAgentId))
        : ignored(state);
    case 'draft.deleted':
      return state.draftId === event.draftId
        ? handled(failed(state, 'deleted', 'Draft was deleted', null))
        : ignored(state);
    case 'capability.result':
      return handled(updateCapability(state, event));
    case 'start.requested': {
      if ((state.phase !== 'pristine' && state.phase !== 'editing') || !state.draft) {
        return ignored(state);
      }
      const capabilities = { ...state.capabilities };
      for (const capability of event.requiredCapabilities) {
        if (capabilities[capability] === 'unknown') capabilities[capability] = 'pending';
      }
      return handled(
        advanceStarting({
          ...state,
          phase: 'starting',
          capabilities,
          requiredCapabilities: Object.fromEntries(
            event.requiredCapabilities.map((capability) => [capability, true]),
          ),
        }),
      );
    }
    case 'promote.issued':
      return state.phase === 'promoting' &&
        state.operationKey === event.operationKey &&
        state.promoteAttempt === 'not-issued'
        ? handled({ ...state, promoteAttempt: 'issued' })
        : ignored(state);
    case 'promote.ack':
      return state.phase === 'promoting' && state.operationKey === event.operationKey
        ? handled(adopting(state, event.workspaceId, event.initialAgentId, event.draft))
        : ignored(state);
    case 'promote.ackLost':
      return state.phase === 'promoting' &&
        state.operationKey === event.operationKey &&
        state.promoteAttempt === 'issued'
        ? handled({ ...state, promoteAttempt: 'ack-lost' })
        : ignored(state);
    case 'adoption.completed':
      if (state.phase !== 'adopting') return ignored(state);
      return event.pendingAttachmentIds.length
        ? handled({
            ...state,
            phase: 'placingAttachments',
            pendingAttachmentIds: [...new Set(event.pendingAttachmentIds)],
          })
        : handled(afterAttachments(state));
    case 'attachments.placed': {
      if (state.phase !== 'placingAttachments') return ignored(state);
      const settled = new Set([...event.placedIds, ...event.failures.map(({ id }) => id)]);
      const remaining = state.pendingAttachmentIds.filter((id) => !settled.has(id));
      if (event.failures.length) {
        const retryState: PlacingAttachmentsState = {
          ...state,
          pendingAttachmentIds: [
            ...remaining,
            ...event.failures.map(({ id }) => id).filter((id) => !remaining.includes(id)),
          ],
        };
        return handled(
          failed(
            state,
            'attachments',
            event.failures.map(({ error }) => error).join('; '),
            retryState,
          ),
        );
      }
      const next = { ...state, pendingAttachmentIds: remaining };
      return handled(remaining.length ? next : afterAttachments(next));
    }
    case 'delivery.reconcileIssued':
      return state.phase === 'sending' &&
        (state.deliveryStage === 'needs-reconcile' || state.deliveryStage === 'unknown')
        ? handled({ ...state, deliveryStage: 'reconciling' })
        : ignored(state);
    case 'delivery.reconciled':
      if (state.phase !== 'sending') return ignored(state);
      if (event.delivery.state === 'sent') {
        return handled({ ...state, phase: 'live', workspaceId: state.workspaceId });
      }
      return handled({
        ...state,
        deliveryStage: event.delivery.state === 'none' ? 'ready' : 'unknown',
      });
    case 'send.issued':
      return state.phase === 'sending' && state.deliveryStage === 'ready'
        ? handled({ ...state, deliveryStage: 'issued' })
        : ignored(state);
    case 'send.ack':
      return state.phase === 'sending' &&
        (state.deliveryStage === 'issued' ||
          state.deliveryStage === 'unknown' ||
          state.deliveryStage === 'reconciling')
        ? handled({ ...state, phase: 'live', workspaceId: state.workspaceId })
        : ignored(state);
    case 'send.unknown':
      return state.phase === 'sending' && state.deliveryStage === 'issued'
        ? handled({ ...state, deliveryStage: 'unknown' })
        : ignored(state);
    case 'daemon.offline': {
      if (state.phase === 'offline') return ignored(state);
      const resumePhase =
        state.phase === 'conflict'
          ? 'editing'
          : state.phase === 'failed'
            ? (state.retryState?.phase ?? 'editing')
            : state.phase;
      return handled({
        ...state,
        phase: 'offline',
        unsavedInput: state.input,
        resumePhase,
      });
    }
    case 'reconnect':
      return state.phase === 'offline'
        ? handled(switchBackend(state, state.generation))
        : ignored(state);
    case 'operation.failed':
      return recoverableForFailure(state)
        ? handled(failed(state, event.kind, event.error))
        : ignored(state);
    case 'retry':
      return state.phase === 'failed' && state.retryState
        ? handled(state.retryState)
        : ignored(state);
    case 'conflict.acceptRemote':
      return state.phase === 'conflict'
        ? handled(editable(acknowledge(state, state.remote, false)))
        : ignored(state);
    case 'conflict.keepLocal':
      return state.phase === 'conflict'
        ? handled(editable(acknowledge(state, state.remote, true)))
        : ignored(state);
  }
}

export function reduce(state: ControllerState, event: ControllerEvent): ControllerState {
  return reduceDetailed(state, event).state;
}
