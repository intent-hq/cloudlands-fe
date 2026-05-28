import { type UnknownAction } from "redux";
import type { StoreAction, StoreActionCreator } from "../types";
import { createAction } from "./create-action";

type BooleanFieldKey<S> = {
  [K in keyof S]-?: S[K] extends boolean ? K : never;
}[keyof S] & string;

export type BooleanPreferenceReducerBuilder<S> = {
  (state: S | undefined, action: StoreAction<any> | UnknownAction): S;
  with<ARGS extends any[], PL = ARGS>(
    action: StoreActionCreator<ARGS, PL>,
    reducer: (state: S, action: StoreAction<PL>) => S
  ): BooleanPreferenceReducerBuilder<S>;
  initialState: S;
};

type CreateBooleanPreferenceOptions<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
> = {
  sliceName: string;
  field: Field;
  setActionName: string;
  toggleActionName: string;
};

export function createBooleanPreference<
  S,
  Field extends BooleanFieldKey<S> = BooleanFieldKey<S>,
>({
  sliceName,
  field,
  setActionName,
  toggleActionName,
}: CreateBooleanPreferenceOptions<S, Field>) {
  const setAction = createAction<[value: boolean]>(`${sliceName}/${setActionName}`);
  const toggleAction = createAction(`${sliceName}/${toggleActionName}`);

  const updateField = (state: S, value: boolean): S => ({
    ...state,
    [field]: value,
  }) as S;

  return {
    setAction,
    toggleAction,
    register(builder: BooleanPreferenceReducerBuilder<S>): BooleanPreferenceReducerBuilder<S> {
      return builder
        .with(setAction, (state, { payload: [value] }) => updateField(state, value))
        .with(toggleAction, (state) => updateField(state, !state[field]));
    },
  };
}