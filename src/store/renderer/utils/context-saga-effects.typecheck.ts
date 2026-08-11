import type { EventChannel, TakeableChannel } from 'redux-saga';

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

type ChannelMessage = {
  contextId: ContextId;
  value: number;
};

type EventMessage = {
  agentId: string;
  sequence: number;
};

declare const takeableChannel: TakeableChannel<ChannelMessage>;
declare const typedEventChannel: EventChannel<EventMessage>;

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

  yield* takeLatestInContext(
    takeableChannel,
    (message) => {
      const inferredMessage: ChannelMessage = message;
      void inferredMessage;
      // @ts-expect-error channel inference must not widen the message to any
      void message.missing;
      return message.contextId;
    },
    function* channelWorker(prefix: { enabled: boolean }, message) {
      const inferredMessage: ChannelMessage = message;
      void prefix;
      void inferredMessage;
      // @ts-expect-error worker message inference must retain the channel message type
      void message.missing;
    },
    { enabled: true },
  );

  yield* takeLeadingInContext(
    typedEventChannel,
    (message) => {
      const inferredMessage: EventMessage = message;
      void inferredMessage;
      return message.agentId;
    },
    function* eventWorker(prefix: string, message) {
      const inferredMessage: EventMessage = message;
      void prefix;
      void inferredMessage;
      // @ts-expect-error EventChannel worker messages retain their concrete type
      void message.missing;
    },
    'event',
  );

  // @ts-expect-error channel context extractors must return a string
  yield* takeLatestInContext(
    takeableChannel,
    () => 1,
    function* worker() {},
  );

  // @ts-expect-error channel prefix arguments must match the worker's leading parameters
  yield* takeLeadingInContext(
    takeableChannel,
    (message) => message.contextId,
    function* worker(prefix: number, message: ChannelMessage) {
      void prefix;
      void message;
    },
    'wrong',
  );

  yield* takeLatestByWorkspace(typedAction, typedWorker, { enabled: true });
  yield* takeLeadingByWorkspace(typedAction, typedWorker, { enabled: true });
  yield* takeLatestByAgent(agentAction, agentWorker);
  yield* takeLeadingByAgent(agentAction, agentWorker);

  // @ts-expect-error agent helpers require an agentId payload
  yield* takeLatestByAgent(typedAction, typedWorker, { enabled: true });
}

void typecheckContextEffects;
