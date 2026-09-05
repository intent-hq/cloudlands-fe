import type { WorkspaceDraft } from '$shared/types/workspace-draft';
import {
  createInitialControllerState,
  reduce,
  type Capability,
  type CapabilityStatus,
  type ControllerState,
  type DraftInput,
  type FailureKind,
} from '../controller';

export const READY_CAPABILITIES: Record<Capability, CapabilityStatus> = {
  provider: 'ready',
  git: 'ready',
  node: 'ready',
  github: 'ready',
};

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

export function bootState(draft: WorkspaceDraft, generation = 0): ControllerState {
  return createInitialControllerState(generation, inputFromDraft(draft));
}

export function restoringState(draft: WorkspaceDraft, generation = 0): ControllerState {
  return reduce(bootState(draft, generation), {
    type: 'backend.connected',
    generation,
    draftId: draft.id,
  });
}

export function restoredState(
  draft: WorkspaceDraft,
  capabilities: Partial<Record<Capability, CapabilityStatus>> = READY_CAPABILITIES,
  generation = 0,
): ControllerState {
  let state = restoringState(draft, generation);
  state = reduce(state, { type: 'restore.succeeded', generation, draft });
  for (const capability of Object.keys(capabilities) as Capability[]) {
    const status = capabilities[capability];
    if (status === undefined) continue;
    state = reduce(state, {
      type: 'capability.result',
      capability,
      status,
      generation,
    });
  }
  return state;
}

export function startingState(
  draft: WorkspaceDraft,
  capability: Capability = 'provider',
): ControllerState {
  const state = restoredState(draft, { ...READY_CAPABILITIES, [capability]: 'pending' });
  return reduce(state, { type: 'start.requested', requiredCapabilities: [capability] });
}

export function promotingState(draft: WorkspaceDraft): ControllerState {
  return reduce(restoredState(draft), {
    type: 'start.requested',
    requiredCapabilities: ['provider'],
  });
}

export function promotionAckLostState(draft: WorkspaceDraft): ControllerState {
  let state = promotingState(draft);
  state = reduce(state, { type: 'promote.issued', operationKey: draft.operationKey });
  return reduce(state, {
    type: 'promote.ackLost',
    operationKey: draft.operationKey,
    generation: state.generation,
  });
}

export function adoptingState(draft: WorkspaceDraft): ControllerState {
  const state = promotingState(draft);
  const workspaceId = '00000000-0000-4000-8000-000000000003';
  const promotedDraft: WorkspaceDraft = {
    ...draft,
    revision: draft.revision + 1,
    phase: 'promoted',
    promotedWorkspaceId: workspaceId,
    initialAgentId: '00000000-0000-4000-8000-000000000004',
  };
  return reduce(state, {
    type: 'promote.ack',
    operationKey: draft.operationKey,
    draft: promotedDraft,
    workspaceId,
    initialAgentId: promotedDraft.initialAgentId,
    generation: state.generation,
  });
}

export function placingAttachmentsState(
  draft: WorkspaceDraft,
  pendingAttachmentIds: string[],
): ControllerState {
  const state = adoptingState(draft);
  return reduce(state, {
    type: 'adoption.completed',
    pendingAttachmentIds,
    generation: state.generation,
  });
}

export function sendingState(
  draft: WorkspaceDraft,
  deliveryStage: Extract<
    ControllerState,
    { phase: 'sending' }
  >['deliveryStage'] = 'needs-reconcile',
): ControllerState {
  const state = adoptingState(draft);
  const sending = reduce(state, {
    type: 'adoption.completed',
    pendingAttachmentIds: [],
    generation: state.generation,
  });
  return sending.phase === 'sending' ? { ...sending, deliveryStage } : sending;
}

export function liveState(draft: WorkspaceDraft): ControllerState {
  const state = sendingState(draft);
  return reduce(state, {
    type: 'delivery.reconciled',
    delivery: { state: 'sent', messageId: '00000000-0000-4000-8000-000000000005' },
    generation: state.generation,
  });
}

export function failedState(
  state: ControllerState,
  kind: FailureKind,
  error: string,
): ControllerState {
  return reduce(state, {
    type: 'operation.failed',
    kind,
    error,
    generation: state.generation,
  });
}

export function offlineState(state: ControllerState): ControllerState {
  return reduce(state, { type: 'daemon.offline' });
}

export function conflictState(draft: WorkspaceDraft, remote: WorkspaceDraft): ControllerState {
  let state = restoredState(draft);
  state = reduce(state, {
    type: 'user.edited',
    patch: { intentText: `${draft.intentText} with local edits` },
  });
  return reduce(state, { type: 'draft.conflict', remote, generation: state.generation });
}

export function backendSwitchedState(draft: WorkspaceDraft): ControllerState {
  return reduce(bootState(draft), { type: 'backend.switched', generation: 1 });
}
