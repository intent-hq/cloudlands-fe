import { createAction as baseCreateAction } from "$lib/store/utils/create-action";
import type { PayloadModifier, StoreAction, StoreActionCreator } from "$lib/store/types";

export type MainStoreAction<PL = undefined> = StoreAction<PL> & {
  __store: "main";
};

export type MainStoreActionCreator<ARGS extends any[] = [], PL = ARGS> = {
  (...args: ARGS): MainStoreAction<PL>;
  type: string;
  toString: () => string;
};

export function createAction<ARGS extends any[], PL>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, PL>
): MainStoreActionCreator<ARGS, PL>;

export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier: PayloadModifier<ARGS, ARGS>
): MainStoreActionCreator<ARGS, ARGS>;

export function createAction(
  actionType: string,
  payloadModifier?: undefined
): MainStoreActionCreator<[], undefined>;

export function createAction<ARGS extends any[]>(
  actionType: string,
  payloadModifier?: undefined
): MainStoreActionCreator<ARGS, ARGS>;

export function createAction<ARGS extends any[] = [], PL = ARGS>(
  actionType: string,
  payloadModifier?: PayloadModifier<ARGS, PL>
): MainStoreActionCreator<ARGS, PL> {
  const baseActionCreator = (payloadModifier
    ? baseCreateAction(actionType, payloadModifier)
    : baseCreateAction(actionType)) as StoreActionCreator<ARGS, PL>;

  const actionCreator = ((...args: ARGS) => ({
    ...baseActionCreator(...args),
    __store: "main" as const,
  })) as MainStoreActionCreator<ARGS, PL>;

  actionCreator.type = baseActionCreator.type;
  actionCreator.toString = baseActionCreator.toString;

  return actionCreator;
}