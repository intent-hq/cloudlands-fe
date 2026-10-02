import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { createAppStoreMock } from '../../utils/test-helpers/store-mock';
import { connectionsReducer, initialState } from './connections-slice';
import type { ConnectionsState } from './connections-types';
import { settingsEventsReducer } from '../settings-events/settings-events-slice';

/** Component tests use the production reducer/watchers; only the transport is mocked. */
export function createConnectionsHarness(
  overrides: () => Partial<ConnectionsState> = () => ({}),
  observeDispatch: (action: any) => void = () => {},
  withApiSettings = false,
) {
  let state = initialState;
  let forms = settingsEventsReducer(undefined, { type: '@@init' });
  let task: Task | undefined;
  let apiTask: Task | undefined;
  const channel = stdChannel();
  const store = createAppStoreMock({
    state: () => ({ connections: { ...state, ...overrides() }, settingsEvents: forms }),
    dispatch: (action) => {
      observeDispatch(action);
      state = connectionsReducer(state, action);
      forms = settingsEventsReducer(forms, action);
      store.emitState();
      channel.put(action);
      return action;
    },
  });
  const createSelector = store.createSelector;
  store.createSelector = (callback) => {
    const selector = createSelector(callback);
    selector.effect = function* (...args: any[]) {
      return yield* select(callback, ...args);
    };
    return selector;
  };
  return {
    store,
    async start() {
      state = initialState;
      forms = settingsEventsReducer(undefined, { type: '@@init' });
      const { connectionsSaga } = await import('./sagas/connections-saga');
      task = runSaga(
        { channel, dispatch: store.dispatch, getState: () => store.state },
        connectionsSaga,
      );
      if (withApiSettings) {
        const { websocketApiSaga } = await import('../websocket-api/sagas/websocket-api-saga');
        apiTask = runSaga(
          { channel, dispatch: store.dispatch, getState: () => store.state },
          websocketApiSaga,
        );
      }
    },
    async stop() {
      apiTask?.cancel();
      task?.cancel();
      await apiTask?.toPromise();
      await task?.toPromise();
    },
  };
}
