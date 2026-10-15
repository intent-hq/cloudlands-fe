import { store } from '@/store';
import { backendReconnected } from '../../../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { backend } from '@/features/backend/backend-transport';
import {
  routeDaemonEventsNotification,
  refreshDaemonEventsAfterReconnect,
} from '@/features/events/daemon-events-router';
import { selectDaemonEventsSubscriptionAttempt } from '../workspace-events-selectors';
import { createDaemonEventsSaga } from '../../../../../../src/store/renderer/slices/workspace-events/sagas/daemon-events-saga-factory';

/** Real global leases for mounted read owners; file/tab navigation is outside this runtime. */
export const daemonEventsSaga = createDaemonEventsSaga({
  ...backend,
  reconnecting: () => {
    store.dispatch(backendReconnected());
  },
  eventTypes: [
    'changes:agent-locks',
    'git:clone:progress',
    'git:clone:done',
    'settings:changed',
    'host:members-changed',
    'host:invites-changed',
    'host:execution-context-changed',
    'principal:identity-changed',
    'workspace:updated',
    'workspace:created',
    'workspace:deleted',
    'agent:*',
  ],
  subscriptionAttemptEffect: selectDaemonEventsSubscriptionAttempt.effect,
  routeNotification: routeDaemonEventsNotification,
  refreshAfterReconnect: refreshDaemonEventsAfterReconnect,
  // This router retains no mutable event buffers outside its saga.
  disposeRouting: () => {},
});
