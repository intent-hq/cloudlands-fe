/**
 * Workspace homes UI state (PROTOCOL `methods/nodes.md` → "Moving the home",
 * "Detached workspaces"): which workspace the Move home dialog targets, the
 * `workspace.setHome` call in flight or its refusal, and the Wait retries in
 * flight. The home itself lives on the workspace entity as served.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { MoveHomeTarget } from '$shared/types/workspace-home';
import type { SetHomeErrorCode } from './workspace-home';

export interface MoveHomeFailure {
  /** A documented refusal, or null for any other failure. */
  code: SetHomeErrorCode | null;
  message: string;
}

export interface WorkspaceHomeUiState {
  dialogWorkspaceId: string | null;
  moveStatus: 'idle' | 'submitting';
  moveFailure: MoveHomeFailure | null;
  /** Workspaces whose Wait retry is in flight. */
  waiting: Record<string, true>;
  /**
   * Failed openings dismissed this session, by `homeSetupFailureKey` (the
   * home and that failure's time), so a later failure of the same home shows.
   */
  dismissedSetupFailures: Record<string, true>;
  /** The home's checkout and setup output, by workspace, read while its log is open. */
  setupOutputs: Record<string, HomeSetupOutput>;
}

/** `home.setup.output` and `outputTruncated` from the workspace's detail read. */
export interface HomeSetupOutput {
  /** The home the output belongs to; another home's output is not shown. */
  homeId: string;
  text?: string;
  truncated: boolean;
}

/** One failed opening of a home: the home and when that attempt failed. */
export function homeSetupFailureKey(homeId: string, finishedAt: string | undefined): string {
  return `${homeId}|${finishedAt ?? ''}`;
}

const initialWorkspaceHomeState: WorkspaceHomeUiState = {
  dialogWorkspaceId: null,
  moveStatus: 'idle',
  moveFailure: null,
  waiting: {},
  dismissedSetupFailures: {},
  setupOutputs: {},
};

/** Open the Move home dialog for a workspace (banner, header menu, panels). */
export const moveHomeDialogOpened = createAction<[workspaceId: string]>(
  'workspaceHome/moveDialogOpened',
);
export const moveHomeDialogClosed = createAction('workspaceHome/moveDialogClosed');
/** Confirm: call `workspace.setHome { workspaceId, to }`. */
export const moveHomeRequested = createAction<[workspaceId: string, to: MoveHomeTarget]>(
  'workspaceHome/moveRequested',
);
/** Saga: the call settled; null closes the dialog, a failure keeps it open. */
export const moveHomeSettled = createAction<[workspaceId: string, failure: MoveHomeFailure | null]>(
  'workspaceHome/moveSettled',
);
/** Wait: ask the backend to reconnect the home, then re-read the workspace. */
export const homeWaitRequested = createAction<[workspaceId: string]>('workspaceHome/waitRequested');
export const homeWaitSettled = createAction<[workspaceId: string]>('workspaceHome/waitSettled');
/** The home's output log is open or its home changed: read the output again. */
export const homeSetupOutputRequested = createAction<[workspaceId: string]>(
  'workspaceHome/setupOutputRequested',
);
/** Saga: the detail read's output. */
export const homeSetupOutputLoaded = createAction<[workspaceId: string, output: HomeSetupOutput]>(
  'workspaceHome/setupOutputLoaded',
);
/** Saga: the read failed; the last output is no longer known to be current. */
export const homeSetupOutputUnavailable = createAction<[workspaceId: string]>(
  'workspaceHome/setupOutputUnavailable',
);
/** Hide a home's failed opening banner (nodes.md "Opening the home"). */
export const homeSetupFailureDismissed = createAction<[failureKey: string]>(
  'workspaceHome/setupFailureDismissed',
);

export const workspaceHomeReducer = createReducer<WorkspaceHomeUiState>(initialWorkspaceHomeState);
workspaceHomeReducer.with(moveHomeDialogOpened, (state, { payload: [workspaceId] }) => ({
  ...state,
  dialogWorkspaceId: workspaceId,
  moveStatus: 'idle',
  moveFailure: null,
}));
workspaceHomeReducer.with(moveHomeDialogClosed, (state) =>
  // A running call keeps the dialog: it closes when the call settles.
  state.moveStatus === 'submitting'
    ? state
    : { ...state, dialogWorkspaceId: null, moveFailure: null },
);
workspaceHomeReducer.with(moveHomeRequested, (state, { payload: [workspaceId] }) =>
  state.moveStatus === 'submitting' || state.dialogWorkspaceId !== workspaceId
    ? state
    : { ...state, moveStatus: 'submitting', moveFailure: null },
);
workspaceHomeReducer.with(moveHomeSettled, (state, { payload: [workspaceId, failure] }) => {
  if (state.dialogWorkspaceId !== workspaceId) return state;
  return failure
    ? { ...state, moveStatus: 'idle', moveFailure: failure }
    : { ...state, dialogWorkspaceId: null, moveStatus: 'idle', moveFailure: null };
});
workspaceHomeReducer.with(homeWaitRequested, (state, { payload: [workspaceId] }) =>
  state.waiting[workspaceId]
    ? state
    : { ...state, waiting: { ...state.waiting, [workspaceId]: true } },
);
workspaceHomeReducer.with(homeWaitSettled, (state, { payload: [workspaceId] }) => {
  if (!state.waiting[workspaceId]) return state;
  const { [workspaceId]: _settled, ...waiting } = state.waiting;
  return { ...state, waiting };
});
workspaceHomeReducer.with(homeSetupFailureDismissed, (state, { payload: [key] }) =>
  state.dismissedSetupFailures[key]
    ? state
    : { ...state, dismissedSetupFailures: { ...state.dismissedSetupFailures, [key]: true } },
);
workspaceHomeReducer.with(homeSetupOutputLoaded, (state, { payload: [workspaceId, output] }) => ({
  ...state,
  setupOutputs: { ...state.setupOutputs, [workspaceId]: output },
}));
workspaceHomeReducer.with(homeSetupOutputUnavailable, (state, { payload: [workspaceId] }) => {
  if (!state.setupOutputs[workspaceId]) return state;
  const { [workspaceId]: _stale, ...setupOutputs } = state.setupOutputs;
  return { ...state, setupOutputs };
});
