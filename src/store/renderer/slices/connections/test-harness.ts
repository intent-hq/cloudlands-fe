import { runSaga, stdChannel, type Task } from 'redux-saga';
import { select } from 'typed-redux-saga';
import { createAppStoreMock } from '../../utils/test-helpers/store-mock';
import { connectionsReducer, initialState } from './connections-slice';
import type { ConnectionsState } from './connections-types';

/** Component tests use the production reducer/watchers; only the transport is mocked. */
export function createConnectionsHarness(
  overrides: () => Partial<ConnectionsState> = () => ({}),
  observeDispatch: (action: any) => void = () => {},
) {
  let state = initialState;
  let task: Task | undefined;
  const channel = stdChannel();
  const store = createAppStoreMock({
    state: () => ({ connections: { ...state, ...overrides() } }),
    dispatch: (action) => {
      observeDispatch(action);
      state = connectionsReducer(state, action);
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
      const { connectionsSaga } = await import('./sagas/connections-saga');
      task = runSaga(
        { channel, dispatch: store.dispatch, getState: () => store.state },
        connectionsSaga,
      );
    },
    async stop() {
      task?.cancel();
      await task?.toPromise();
    },
  };
}
