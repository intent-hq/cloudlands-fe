import type { EventChannel, TakeableChannel } from 'redux-saga';

import {
  takeEveryByContextFIFO,
  takeLatestByAgent,
  takeLatestByWorkspace,
  takeLatestInContext,
  takeLeadingByAgent,
  takeLeadingByWorkspace,
  takeLeadingInContext,
  takeSingleFlightInContext,
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
  yield* takeEveryByContextFIFO(
    typedAction,
    (action) => {
      const inferredAction: ReturnType<typeof typedAction> = action;
      void inferredAction;
      // @ts-expect-error FIFO pattern inference must not widen the action to any
      void action.missing;
      return action.payload[0];
    },
    typedWorker,
    {
      onDiscardPending: function* discard(action) {
        const inferredAction: ReturnType<typeof typedAction> = action;
        void inferredAction;
        // @ts-expect-error pending action inference must retain the pattern action type
        void action.missing;
      },
    },
    { enabled: true },
  );

  yield* takeEveryByContextFIFO(
    takeableChannel,
    (message) => message.contextId,
    function* channelWorker(prefix: string, message) {
      const inferredMessage: ChannelMessage = message;
      void prefix;
      void inferredMessage;
    },
    {
      onDiscardPending: function* discard(message) {
        const inferredMessage: ChannelMessage = message;
        void inferredMessage;
        // @ts-expect-error pending channel messages retain their concrete type
        void message.missing;
      },
    },
    'fifo',
  );

  yield* takeEveryByContextFIFO(
    typedEventChannel,
    (message) => message.agentId,
    function* eventWorker(message) {
      const inferredMessage: EventMessage = message;
      void inferredMessage;
    },
    {
      onDiscardPending: function* discard(message) {
        const inferredMessage: EventMessage = message;
        void inferredMessage;
      },
    },
  );

  // @ts-expect-error FIFO context extractors must return a string
  yield* takeEveryByContextFIFO(typedAction, () => 1, typedWorker, {}, { enabled: true });

  // @ts-expect-error FIFO prefix arguments must match the worker's leading parameters
  yield* takeEveryByContextFIFO(
    takeableChannel,
    (message) => message.contextId,
    function* worker(prefix: number, message: ChannelMessage) {
      void prefix;
      void message;
    },
    {},
    'wrong',
  );

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
  yield* takeSingleFlightInContext(
    typedAction,
    (action) =>
      action.payload[1] < 0 ? { context: action.payload[0], cancel: true } : action.payload[0],
    typedWorker,
    { enabled: true },
  );
  yield* takeSingleFlightInContext(
    takeableChannel,
    (message) => message.contextId,
    function* channelWorker(prefix: string, message) {
      const inferredMessage: ChannelMessage = message;
      void prefix;
      void inferredMessage;
    },
    'single-flight',
  );

  // @ts-expect-error single-flight context extractors must return a string or cancellation directive
  yield* takeSingleFlightInContext(typedAction, () => 1, typedWorker, { enabled: true });

  // @ts-expect-error agent helpers require an agentId payload
  yield* takeLatestByAgent(typedAction, typedWorker, { enabled: true });
}

void typecheckContextEffects;
