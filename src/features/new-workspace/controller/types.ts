import type {
  ContextLink,
  DraftSource,
  SetupResult,
  WorkspaceDraft,
  WorkspaceDraftConfig,
} from '$shared/types';

export const CONTROLLER_PHASES = [
  'boot',
  'restoring',
  'pristine',
  'editing',
  'starting',
  'promoting',
  'adopting',
  'placingAttachments',
  'sending',
  'live',
  'failed',
  'offline',
  'conflict',
] as const;

export type ControllerPhase = (typeof CONTROLLER_PHASES)[number];
export type Capability = 'provider' | 'git' | 'node' | 'github';
export type CapabilityStatus = 'pending' | 'ready' | 'missing' | 'unknown';

export interface DraftInput {
  title?: string;
  intentText: string;
  source: DraftSource | null;
  contextLinks: ContextLink[];
  attachments: unknown[];
  config: WorkspaceDraftConfig;
}

export interface ControllerData {
  generation: number;
  ownerClientId: string | null;
  draftId: string | null;
  draft: WorkspaceDraft | null;
  input: DraftInput;
  inputVersion: number;
  acknowledgedInput: DraftInput | null;
  acknowledgedRevision: number | null;
  saveInFlightVersion: number | null;
  creationIssued: boolean;
  capabilities: Record<Capability, CapabilityStatus>;
  workspaceId: string | null;
  initialAgentId: string | null;
  setupResult: SetupResult | null;
}

export interface BootState extends ControllerData {
  phase: 'boot';
}
interface RestoringState extends ControllerData {
  phase: 'restoring';
}
export interface PristineState extends ControllerData {
  phase: 'pristine';
}
export interface EditingState extends ControllerData {
  phase: 'editing';
}
export interface StartingState extends ControllerData {
  phase: 'starting';
  requiredCapabilities: Partial<Record<Capability, true>>;
}
export interface PromotingState extends ControllerData {
  phase: 'promoting';
  operationKey: string;
  promoteAttempt: 'not-issued' | 'issued' | 'ack-lost';
}
export interface AdoptingState extends ControllerData {
  phase: 'adopting';
  workspaceId: string;
}
export interface PlacingAttachmentsState extends ControllerData {
  phase: 'placingAttachments';
  workspaceId: string;
  pendingAttachmentIds: string[];
}
export interface SendingState extends ControllerData {
  phase: 'sending';
  workspaceId: string;
  deliveryStage: 'needs-reconcile' | 'reconciling' | 'ready' | 'issued' | 'unknown';
}
interface LiveState extends ControllerData {
  phase: 'live';
  workspaceId: string;
}

export type RecoverableState =
  | RestoringState
  | PristineState
  | EditingState
  | StartingState
  | PromotingState
  | AdoptingState
  | PlacingAttachmentsState
  | SendingState;

export type FailureKind =
  'restore' | 'draft' | 'prerequisites' | 'promote' | 'adopt' | 'attachments' | 'send' | 'deleted';

export interface FailedState extends ControllerData {
  phase: 'failed';
  kind: FailureKind;
  error: string;
  retryState: RecoverableState | null;
}
interface OfflineState extends ControllerData {
  phase: 'offline';
  unsavedInput: DraftInput;
  resumePhase: Exclude<ControllerPhase, 'offline' | 'conflict' | 'failed'>;
}
interface ConflictState extends ControllerData {
  phase: 'conflict';
  remote: WorkspaceDraft;
}

export type ControllerState =
  | BootState
  | RestoringState
  | PristineState
  | EditingState
  | StartingState
  | PromotingState
  | AdoptingState
  | PlacingAttachmentsState
  | SendingState
  | LiveState
  | FailedState
  | OfflineState
  | ConflictState;

export const CONTROLLER_EVENT_TYPES = [
  'backend.connected',
  'backend.switched',
  'restore.succeeded',
  'restore.missing',
  'user.edited',
  'draft.createIssued',
  'draft.saveIssued',
  'draft.acknowledged',
  'draft.updated',
  'draft.conflict',
  'draft.promoted',
  'draft.deleted',
  'capabilities.recheckRequested',
  'capability.result',
  'start.requested',
  'promote.issued',
  'promote.ack',
  'promote.ackLost',
  'adoption.completed',
  'attachments.placed',
  'delivery.reconcileIssued',
  'delivery.reconciled',
  'send.issued',
  'send.ack',
  'send.unknown',
  'daemon.offline',
  'reconnect',
  'operation.failed',
  'retry',
  'conflict.acceptRemote',
  'conflict.keepLocal',
] as const;

export type ControllerEventType = (typeof CONTROLLER_EVENT_TYPES)[number];
type Generated = { generation: number };

export type ControllerEvent =
  | ({ type: 'backend.connected'; ownerClientId?: string; draftId?: string } & Generated)
  | { type: 'backend.switched'; generation: number }
  | ({ type: 'restore.succeeded'; draft: WorkspaceDraft } & Generated)
  | ({ type: 'restore.missing' } & Generated)
  | { type: 'user.edited'; patch: Partial<DraftInput> }
  | { type: 'draft.createIssued'; inputVersion: number }
  | { type: 'draft.saveIssued'; inputVersion: number }
  | ({ type: 'draft.acknowledged'; draft: WorkspaceDraft; inputVersion: number } & Generated)
  | ({ type: 'draft.updated'; draft: WorkspaceDraft } & Generated)
  | ({ type: 'draft.conflict'; remote: WorkspaceDraft } & Generated)
  | ({
      type: 'draft.promoted';
      draftId: string;
      workspaceId: string;
      initialAgentId?: string;
    } & Generated)
  | ({ type: 'draft.deleted'; draftId: string } & Generated)
  | { type: 'capabilities.recheckRequested'; capabilities: Capability[] }
  | ({ type: 'capability.result'; capability: Capability; status: CapabilityStatus } & Generated)
  | { type: 'start.requested'; requiredCapabilities: Capability[] }
  | { type: 'promote.issued'; operationKey: string }
  | ({
      type: 'promote.ack';
      operationKey: string;
      draft: WorkspaceDraft;
      workspaceId: string;
      initialAgentId?: string;
    } & Generated)
  | ({ type: 'promote.ackLost'; operationKey: string } & Generated)
  | ({
      type: 'adoption.completed';
      pendingAttachmentIds: string[];
      setupResult?: SetupResult | null;
    } & Generated)
  | ({
      type: 'attachments.placed';
      placedIds: string[];
      failures: Array<{ id: string; error: string }>;
    } & Generated)
  | { type: 'delivery.reconcileIssued' }
  | ({ type: 'delivery.reconciled'; delivery: WorkspaceDraft['delivery'] } & Generated)
  | { type: 'send.issued' }
  | ({ type: 'send.ack'; messageId?: string } & Generated)
  | ({ type: 'send.unknown' } & Generated)
  | { type: 'daemon.offline' }
  | { type: 'reconnect' }
  | ({ type: 'operation.failed'; kind: FailureKind; error: string } & Generated)
  | { type: 'retry' }
  | { type: 'conflict.acceptRemote' }
  | { type: 'conflict.keepLocal' };

type TransitionDisposition = 'handled' | 'ignored';
export interface ControllerTransition {
  state: ControllerState;
  disposition: TransitionDisposition;
}

export type ControllerEffect =
  | { type: 'identifyBackend'; generation: number }
  | { type: 'restoreDraft'; generation: number; draftId: string }
  | {
      type: 'createDraft';
      generation: number;
      ownerClientId: string | null;
      inputVersion: number;
      input: DraftInput;
    }
  | {
      type: 'updateDraft';
      generation: number;
      draftId: string;
      expectedRevision: number;
      inputVersion: number;
      input: DraftInput;
    }
  | { type: 'probeCapability'; generation: number; capability: Capability }
  | {
      type: 'promoteDraft';
      generation: number;
      draftId: string;
      expectedRevision: number;
      operationKey: string;
    }
  | { type: 'reconcilePromotion'; generation: number; draftId: string; operationKey: string }
  | { type: 'adoptWorkspace'; generation: number; workspaceId: string }
  | {
      type: 'placeAttachments';
      generation: number;
      workspaceId: string;
      attachmentIds: string[];
    }
  | { type: 'reconcileDelivery'; generation: number; draftId: string }
  | {
      type: 'sendFirstMessage';
      generation: number;
      draftId: string;
      workspaceId: string;
      initialAgentId: string | null;
      input: DraftInput;
    };

const EMPTY_DRAFT_INPUT: DraftInput = {
  intentText: '',
  source: null,
  contextLinks: [],
  attachments: [],
  config: {},
};

const UNKNOWN_CAPABILITIES: Record<Capability, CapabilityStatus> = {
  provider: 'unknown',
  git: 'unknown',
  node: 'unknown',
  github: 'unknown',
};

export function createInitialControllerState(
  generation: number,
  input: DraftInput = EMPTY_DRAFT_INPUT,
): BootState {
  return {
    phase: 'boot',
    generation,
    ownerClientId: null,
    draftId: null,
    draft: null,
    input,
    inputVersion: 0,
    acknowledgedInput: null,
    acknowledgedRevision: null,
    saveInFlightVersion: null,
    creationIssued: false,
    capabilities: { ...UNKNOWN_CAPABILITIES },
    workspaceId: null,
    initialAgentId: null,
    setupResult: null,
  };
}
