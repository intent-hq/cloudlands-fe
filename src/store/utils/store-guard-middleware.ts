import type { GenericAction, StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";

import type { StoreTarget } from "./types";

type StoreTaggedAction = GenericAction & {
  type: string;
  __store?: StoreTarget;
};

export const createStoreGuardMiddleware = (expectedTarget: StoreTarget): StoreMiddleware => {
   
  return (_store) => (next) => (action) => {
    const taggedAction = action as StoreTaggedAction;

    if (taggedAction.__store && taggedAction.__store !== expectedTarget) {
      throw new Error(
        `Action "${String(taggedAction.type)}" is tagged for "${taggedAction.__store}" store ` +
          `but was dispatched to "${expectedTarget}" store`
      );
    }

    return next(action);
  };
};
