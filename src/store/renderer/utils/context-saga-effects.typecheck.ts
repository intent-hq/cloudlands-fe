import { takeLatestInContext, takeLeadingInContext } from './context-saga-effects';

type ContextId = string & { readonly contextId: unique symbol };
type TypedAction = {
  type: 'typecheck/context';
  payload: [contextId: ContextId, value: number];
};

declare const typedAction: {
  (contextId: ContextId, value: number): TypedAction;
  toString(): string;
};

function* typedWorker(
  prefix: { enabled: boolean },
  action: ReturnType<typeof typedAction>,
): Generator {
  void prefix;
  void action;
}

function* typecheckContextEffects(): Generator {
  yield* takeLatestInContext(
    typedAction,
    (action) => {
      const inferredAction: ReturnType<typeof typedAction> = action;
      void inferredAction;
      // @ts-expect-error pattern inference must not widen the action to any
      void action.missing;
      return action.payload[0];
    },
    typedWorker,
    { enabled: true },
  );

  // @ts-expect-error context extractors must return a string
  yield* takeLatestInContext(typedAction, () => 1, typedWorker, { enabled: true });

  // @ts-expect-error prefix arguments must match the worker's leading parameters
  yield* takeLeadingInContext(typedAction, (action) => action.payload[0], typedWorker, 'wrong');
}

void typecheckContextEffects;
