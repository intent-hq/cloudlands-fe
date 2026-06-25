import { shallowEqual } from 'fast-equals';
import type { StoreAction, StoreActionCreator } from '../../types';

type UnknownAction = { type: string } & Record<string, unknown>;

export type StoreReducer<S, A> = (state: S, action: A) => S;

export const createReducer = <S, A extends StoreAction<any> = StoreAction<any>>(
  initialState: S,
) => {
  const handlers: Record<string, StoreReducer<S, any>> = {};
  const withReducer = <ARGS extends any[], PL = ARGS>(
    action: StoreActionCreator<ARGS, PL>,
    reducer: StoreReducer<S, StoreAction<PL>>,
  ) => {
    handlers[action.type] = reducer;
    return storeReducer;
  };
  const storeReducer = (state: S | undefined = initialState, action: StoreAction<any> | UnknownAction): S => {
    const handler = handlers[action.type];
    const nextState = handler?.(state, action) ?? state;
    return shallowEqual(nextState, state) ? state : nextState;
  };
  storeReducer.with = withReducer;
  storeReducer.initialState = initialState;
  return storeReducer;
};
