import {
  takeLatestByAgent,
  takeLatestByWorkspace,
  takeLatestInContext,
  takeLeadingByAgent,
  takeLeadingByWorkspace,
  takeLeadingInContext,
} from './context-saga-effects';

type ContextId = string & { readonly contextId: unique symbol };
type TypedAction = {
  type: 'typecheck/context';
  payload: [contextId: ContextId, value: number];
};

declare const typedAction: {
  (contextId: ContextId, value: number): TypedAction;
  toString(): string;
};

type AgentAction = {
  type: 'typecheck/agent';
  payload: { agentId: string; force: boolean };
};

declare const agentAction: {
  (agentId: string, force: boolean): AgentAction;
  toString(): string;
};

function* typedWorker(
  prefix: { enabled: boolean },
  action: ReturnType<typeof typedAction>,
): Generator {
  void prefix;
  void action;
}

function* agentWorker(action: ReturnType<typeof agentAction>): Generator {
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

  yield* takeLatestByWorkspace(typedAction, typedWorker, { enabled: true });
  yield* takeLeadingByWorkspace(typedAction, typedWorker, { enabled: true });
  yield* takeLatestByAgent(agentAction, agentWorker);
  yield* takeLeadingByAgent(agentAction, agentWorker);

  // @ts-expect-error agent helpers require an agentId payload
  yield* takeLatestByAgent(typedAction, typedWorker, { enabled: true });
}

void typecheckContextEffects;
