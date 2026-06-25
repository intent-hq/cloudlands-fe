import { createAction } from './create-action.js';
import type { StoreAction, StoreActionCreator } from '../../types';

type UnknownAction = { type: string } & Record<string, unknown>;

type BooleanFieldKey<S> = {
  [K in keyof S]-?: S[K] extends boolean ? K : never;
}[keyof S] &
  string;

export type BooleanPreferenceReducerBuilder<S> = {
  (state: S | undefined, action: StoreAction<any> | UnknownAction): S;
  with<ARGS extends any[], PL = ARGS>(
    action: StoreActionCreator<ARGS, PL>,
    reducer: (state: S, action: StoreAction<PL>) => S,
  ): BooleanPreferenceReducerBuilder<S>;
  initialState: S;
};

type CreateBooleanPreferenceOptions<S, Field extends BooleanFieldKey<S> = BooleanFieldKey<S>> = {
  sliceName: string;
  field: Field;
  setActionName: string;
  toggleActionName: string;
};

export function createBooleanPreference<S, Field extends BooleanFieldKey<S> = BooleanFieldKey<S>>({
  sliceName,
  field,
  setActionName,
  toggleActionName,
}: CreateBooleanPreferenceOptions<S, Field>): {
  setAction: StoreActionCreator<[value: boolean], [value: boolean]>;
  toggleAction: StoreActionCreator<[], undefined>;
  register(builder: BooleanPreferenceReducerBuilder<S>): BooleanPreferenceReducerBuilder<S>;
} {
  const setAction = createAction<[value: boolean]>(`${sliceName}/${setActionName}`);
  const toggleAction = createAction(`${sliceName}/${toggleActionName}`);
  const updateField = (state: S, value: boolean): S => ({
    ...state,
    [field]: value,
  });
  return {
    setAction,
    toggleAction,
    register(builder) {
      return builder
        .with(setAction, (state, { payload: [value] }) => updateField(state, value))
        .with(toggleAction, (state) => updateField(state, !state[field]));
    },
  };
}
