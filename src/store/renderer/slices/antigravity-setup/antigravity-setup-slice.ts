import { createAction } from '@augmentcode/themis/utils/store/create-action';
import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import {
  isAntigravitySetupBusy,
  type AntigravitySetupAction,
  type AntigravitySetupResult,
} from '$shared/types/antigravity-setup';

export type SetupCommand = AntigravitySetupAction | 'close';
export type AntigravitySetupState = {
  generation: number;
  command: SetupCommand;
  busy: boolean;
  attempted: boolean;
  verified: boolean;
  result: AntigravitySetupResult | null;
};
export const initialState: AntigravitySetupState = {
  generation: 0,
  command: 'close',
  busy: false,
  attempted: false,
  verified: false,
  result: null,
};
export const antigravitySetupRequested = createAction<[command: SetupCommand]>(
  'antigravitySetup/requested',
);
export const antigravitySetupReceived = createAction<
  [generation: number, result: AntigravitySetupResult]
>('antigravitySetup/received');
/** Fresh session and model checks passed; does not change any preference. */
export const antigravitySetupVerified = createAction('antigravitySetup/verified');

export const antigravitySetupReducer = createReducer<AntigravitySetupState>(initialState);
antigravitySetupReducer.with(antigravitySetupRequested, (state, { payload: [command] }) => {
  if (state.busy && command === state.command && (command === 'start' || command === 'login'))
    return state;
  return {
    generation: state.generation + 1,
    command,
    busy: command !== 'cancel' && command !== 'close',
    attempted:
      command === 'close' ? false : state.attempted || command === 'start' || command === 'login',
    verified: command === 'status' ? state.verified : false,
    result: command === 'close' ? null : state.result,
  };
});
antigravitySetupReducer.with(
  antigravitySetupReceived,
  (state, { payload: [generation, result] }) =>
    generation !== state.generation
      ? state
      : {
          ...state,
          result,
          busy: result.ok && isAntigravitySetupBusy(result.status),
          verified: state.verified && result.ok && result.status.phase === 'connected',
        },
);
antigravitySetupReducer.with(antigravitySetupVerified, (state) =>
  state.attempted ? { ...state, verified: true } : state,
);
