/**
 * Settings → Machines → Add machine → Intent on this computer (Labs): the
 * requester side of local code pairing. The typed code never enters state;
 * it is handed to the saga through `stashLocalCode`.
 */
import { createAction } from '@themislib/themis/utils/store/create-action';
import { createReducer } from '@themislib/themis/utils/store/create-reducer';
import type { LocalIntent, LocalRedeemError } from '$shared/types/local-pairing';

export type LocalIntentAddPhase = 'closed' | 'ready' | 'redeeming' | 'added';

export interface LocalIntentAddState {
  phase: LocalIntentAddPhase;
  /** null until the folder was read once. */
  intents: LocalIntent[] | null;
  /** The last read failed (the list keeps its previous value). */
  listFailed: boolean;
  selectedId: string | null;
  error: LocalRedeemError | null;
  /** Name shown once added. */
  addedName: string | null;
  /** Bumped when the typed code can never work again, so the field clears. */
  codeResets: number;
}

const initialLocalIntentAddState: LocalIntentAddState = {
  phase: 'closed',
  intents: null,
  listFailed: false,
  selectedId: null,
  error: null,
  addedName: null,
  codeResets: 0,
};

export const localIntentAddOpened = createAction('localIntentAdd/opened');
export const localIntentAddClosed = createAction('localIntentAdd/closed');
export const localIntentsListed =
  createAction<[intents: LocalIntent[] | null]>('localIntentAdd/listed');
export const localIntentPicked = createAction<[instanceId: string]>('localIntentAdd/picked');
/** Redeem the stashed code against the picked Intent. */
export const localIntentRedeemSubmitted = createAction('localIntentAdd/redeemSubmitted');
export const localIntentRedeemFailed = createAction<[error: LocalRedeemError, clearCode: boolean]>(
  'localIntentAdd/redeemFailed',
);
export const localIntentAdded = createAction<[name: string]>('localIntentAdd/added');
/** The user edited the code: a format error no longer applies. */
export const localIntentCodeEdited = createAction('localIntentAdd/codeEdited');

export const localIntentAddReducer = createReducer<LocalIntentAddState>(initialLocalIntentAddState);
localIntentAddReducer.with(localIntentAddOpened, (state) => ({
  ...initialLocalIntentAddState,
  phase: 'ready',
  codeResets: state.codeResets + 1,
}));
localIntentAddReducer.with(localIntentAddClosed, (state) => ({
  ...initialLocalIntentAddState,
  codeResets: state.codeResets + 1,
}));
localIntentAddReducer.with(localIntentsListed, (state, { payload: [intents] }) => {
  if (state.phase === 'closed') return state;
  if (!intents) return { ...state, listFailed: true };
  // Keep the pick while it is listed; otherwise pick the only one.
  const selectedId = intents.some((intent) => intent.instanceId === state.selectedId)
    ? state.selectedId
    : intents.length === 1
      ? (intents[0]?.instanceId ?? null)
      : null;
  return { ...state, intents, listFailed: false, selectedId };
});
localIntentAddReducer.with(localIntentPicked, (state, { payload: [selectedId] }) =>
  state.phase === 'ready' ? { ...state, selectedId, error: null } : state,
);
localIntentAddReducer.with(localIntentRedeemSubmitted, (state) =>
  state.phase === 'ready' ? { ...state, phase: 'redeeming', error: null } : state,
);
localIntentAddReducer.with(localIntentRedeemFailed, (state, { payload: [error, clearCode] }) =>
  state.phase === 'redeeming'
    ? {
        ...state,
        phase: 'ready',
        error,
        codeResets: clearCode ? state.codeResets + 1 : state.codeResets,
      }
    : state,
);
localIntentAddReducer.with(localIntentAdded, (state, { payload: [addedName] }) =>
  state.phase === 'redeeming'
    ? { ...state, phase: 'added', addedName, error: null, codeResets: state.codeResets + 1 }
    : state,
);
localIntentAddReducer.with(localIntentCodeEdited, (state) =>
  state.error?.code === 'code-format' ? { ...state, error: null } : state,
);

/** The code typed in the form, held here only between submit and the saga. */
let stashedCode: string | null = null;

export function stashLocalCode(code: string): void {
  stashedCode = code;
}

export function takeLocalCode(): string | null {
  const code = stashedCode;
  stashedCode = null;
  return code;
}
