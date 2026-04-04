/**
 * Main-process root reducer map.
 *
 * combineReducers({}) would throw, so init.ts handles the empty case.
 */

import { agentSubscriptionsReducer } from "./slices/agent-subscriptions/agent-subscriptions-slice";
import { messageAccumulatorReducer } from "./slices/message-accumulator/message-accumulator-slice";
import { workspaceEventsReducer } from "./slices/workspace-events/workspace-events-slice";

export const reducers = {
  agentSubscriptions: agentSubscriptionsReducer,
  messageAccumulator: messageAccumulatorReducer,
  workspaceEvents: workspaceEventsReducer,
} as const;
