import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import type { WorkspaceCreateProgressState } from './workspace-create-progress-types';

export const initialState: WorkspaceCreateProgressState = {
  byProgressId: {},
};

/**
 * Register an in-flight create's FE-minted progressId BEFORE the
 * `workspace.create` request is sent, so `git:clone:progress` frames arriving
 * mid-flight have an entry to fold into. Frames for unregistered progressIds
 * are ignored (concurrent creates never cross-talk).
 */
export const beginWorkspaceCreateProgress = createAction<[progressId: string]>(
  'workspaceCreateProgress/begin',
);

/** Fold a `git:clone:progress` frame (§6.5) into the registered entry. */
export const workspaceCreateProgressReceived = createAction<
  [progressId: string, progress: { phase: string; percent: number; message?: string }]
>('workspaceCreateProgress/progressReceived');

/** Fold the terminal `git:clone:done` frame (§6.5) into the registered entry. */
export const workspaceCreateProgressDone = createAction<
  [progressId: string, outcome: { ok: boolean; error?: string; errorCode?: string }]
>('workspaceCreateProgress/done');

/** Drop the entry once the create settles (success or failure). */
export const clearWorkspaceCreateProgress = createAction<[progressId: string]>(
  'workspaceCreateProgress/clear',
);

export const workspaceCreateProgressReducer =
  createReducer<WorkspaceCreateProgressState>(initialState);
workspaceCreateProgressReducer.with(
  beginWorkspaceCreateProgress,
  (state, { payload: [progressId] }) => ({
    byProgressId: {
      ...state.byProgressId,
      [progressId]: { phase: 'starting', percent: 0, sawFrame: false, done: false },
    },
  }),
);
workspaceCreateProgressReducer.with(
  workspaceCreateProgressReceived,
  (state, { payload: [progressId, progress] }) => {
    const entry = state.byProgressId[progressId];
    // Unregistered progressId (no create in flight) or already-terminal entry:
    // ignore the frame rather than resurrecting state.
    if (!entry || entry.done) return state;
    return {
      byProgressId: {
        ...state.byProgressId,
        [progressId]: {
          ...entry,
          phase: progress.phase,
          percent: progress.percent,
          message: progress.message,
          sawFrame: true,
        },
      },
    };
  },
);
workspaceCreateProgressReducer.with(
  workspaceCreateProgressDone,
  (state, { payload: [progressId, outcome] }) => {
    const entry = state.byProgressId[progressId];
    if (!entry) return state;
    return {
      byProgressId: {
        ...state.byProgressId,
        [progressId]: {
          ...entry,
          sawFrame: true,
          done: true,
          ok: outcome.ok,
          error: outcome.error,
          errorCode: outcome.errorCode,
        },
      },
    };
  },
);
workspaceCreateProgressReducer.with(
  clearWorkspaceCreateProgress,
  (state, { payload: [progressId] }) => {
    if (!(progressId in state.byProgressId)) return state;
    const byProgressId = { ...state.byProgressId };
    delete byProgressId[progressId];
    return { byProgressId };
  },
);
