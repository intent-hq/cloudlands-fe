import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { FocusFrame } from '$features/presence/presence-focus-channel';

export interface PresenceFollowState {
  scope: string | null;
  context: string | null;
  workspaceId: string | null;
  frames: Record<string, FocusFrame>;
  navigation: { requestId: string; principalId: string } | null;
}
const initialState: PresenceFollowState = {
  scope: null,
  context: null,
  workspaceId: null,
  frames: {},
  navigation: null,
};
export const presenceFollowScopeChanged = createAction<
  [scope: string | null, context: string | null, workspaceId: string | null]
>('presenceFollow/scopeChanged');
export const presenceFollowFrameReceived = createAction<
  [scope: string, principalId: string, frame: FocusFrame | null]
>('presenceFollow/frameReceived');
export const followPresencePersonRequested = createAction<
  [
    scope: string,
    principalId: string,
    generation: number,
    seq: number,
    requestId: string,
    sourcePanelId?: string,
    adjacent?: boolean,
  ]
>('presenceFollow/personRequested');
export const presenceFollowNavigationFinished = createAction<[requestId: string]>(
  'presenceFollow/navigationFinished',
);
export const presenceFollowReducer = createReducer<PresenceFollowState>(initialState);
presenceFollowReducer.with(
  presenceFollowScopeChanged,
  (_state, { payload: [scope, context, workspaceId] }) => ({
    ...initialState,
    scope,
    context,
    workspaceId,
  }),
);
presenceFollowReducer.with(
  presenceFollowFrameReceived,
  (state, { payload: [scope, principalId, frame] }) => {
    if (state.scope !== scope) return state;
    const frames = { ...state.frames };
    if (frame) frames[principalId] = frame;
    else delete frames[principalId];
    return { ...state, frames };
  },
);
presenceFollowReducer.with(
  followPresencePersonRequested,
  (state, { payload: [scope, principalId, generation, seq, requestId] }) => {
    const frame = state.frames[principalId];
    return state.scope === scope &&
      frame?.target &&
      frame.generation === generation &&
      frame.seq === seq
      ? { ...state, navigation: { requestId, principalId } }
      : state;
  },
);
presenceFollowReducer.with(presenceFollowNavigationFinished, (state, { payload: [requestId] }) =>
  state.navigation?.requestId === requestId ? { ...state, navigation: null } : state,
);
