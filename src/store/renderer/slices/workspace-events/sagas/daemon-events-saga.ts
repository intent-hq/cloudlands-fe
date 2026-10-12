// Svelte event binding; retire with the Svelte renderer.
import {
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import {
  DAEMON_EVENTS_SUBSCRIBE_TYPES,
  disposeDaemonEventsRoutingState,
  refreshDaemonEventsAfterReconnect,
  routeDaemonEventsNotification,
} from '$features/events/daemon-events-bridge.client';
import { notifyInterruptedAgentsSubscriptionReady } from '$features/agent/interrupted-agents-service';
import { selectCurrentWorkspaceTabId } from '../../tab-state/tab-state-selectors';
import { CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS } from '../../tab-state/tab-state-slice';
import { selectDaemonEventsSubscriptionAttempt } from '../workspace-events-selectors';

import { createDaemonEventsSaga } from './daemon-events-saga-factory';
export {
  FILE_EVENTS_REPLACE_GROUP,
  FILE_EVENTS_SUBSCRIBE_TYPES,
} from './daemon-events-saga-factory';
// Resolve source transport exports when called; remove this binding at renderer cutover.
export const daemonEventsSaga = createDaemonEventsSaga({
  backendSubscribe: <T>(...args: Parameters<typeof backendSubscribe>): Promise<T> =>
    backendSubscribe<T>(...args),
  backendUnsubscribe: (
    ...args: Parameters<typeof backendUnsubscribe>
  ): ReturnType<typeof backendUnsubscribe> => backendUnsubscribe(...args),
  onBackendNotification: (
    ...args: Parameters<typeof onBackendNotification>
  ): ReturnType<typeof onBackendNotification> => onBackendNotification(...args),
  onBackendReconnected: (
    ...args: Parameters<typeof onBackendReconnected>
  ): ReturnType<typeof onBackendReconnected> => onBackendReconnected(...args),
  eventTypes: DAEMON_EVENTS_SUBSCRIBE_TYPES,
  subscriptionAttemptEffect: selectDaemonEventsSubscriptionAttempt.effect,
  routeNotification: routeDaemonEventsNotification,
  disposeRouting: disposeDaemonEventsRoutingState,
  refreshAfterReconnect: refreshDaemonEventsAfterReconnect,
  subscriptionReady: notifyInterruptedAgentsSubscriptionReady,
  scopedFiles: {
    selectionActions: CURRENT_WORKSPACE_TAB_SELECTION_ACTIONS,
    workspaceIdEffect: selectCurrentWorkspaceTabId.effect,
  },
});
