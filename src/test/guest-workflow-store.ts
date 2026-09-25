import { runSaga, stdChannel } from 'redux-saga';
import {
  guestSessionsReducer,
  initialState as guestSessions,
} from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import {
  connectionsReducer,
  initialState as connections,
} from '$store/renderer/slices/connections/connections-slice';
import {
  workspaceReducer,
  initialState as workspace,
} from '$store/renderer/slices/workspace/workspace-slice';

/** Component tests exercise production reducers and root-owned workflow sagas. */
export function createGuestWorkflowTestStore() {
  const freshState = () => ({ guestSessions, connections, workspace });
  let state = freshState();
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const store = {
    get state() {
      return state;
    },
    init() {
      state = freshState();
      listeners.forEach((notify) => notify());
    },
    dispatch(action: { type: string }) {
      state = {
        guestSessions: guestSessionsReducer(state.guestSessions, action as never),
        connections: connectionsReducer(state.connections, action as never),
        workspace: workspaceReducer(state.workspace, action as never),
      };
      channel.put(action);
      listeners.forEach((notify) => notify());
      return action;
    },
    createSelector<T, A extends unknown[]>(
      select: (state: ReturnType<typeof freshState>, ...args: A) => T,
    ) {
      return Object.assign(
        (...args: A) => ({
          subscribe(run: (value: T) => void) {
            const update = () => run(select(state, ...args));
            update();
            listeners.add(update);
            return () => listeners.delete(update);
          },
        }),
        {
          select,
          effect: function* (...args: A) {
            return select(state, ...args);
          },
        },
      );
    },
    runSaga(saga: () => Generator) {
      const reduxStore = {
        getState: () => state,
        subscribe(notify: () => void) {
          listeners.add(notify);
          return () => listeners.delete(notify);
        },
      };
      const task = runSaga(
        {
          channel,
          dispatch: store.dispatch,
          getState: reduxStore.getState,
          context: { reduxStore },
        },
        saga,
      );
      return () => task.cancel();
    },
  };
  return store;
}
