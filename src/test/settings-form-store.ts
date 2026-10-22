import { runSaga, stdChannel } from 'redux-saga';
import { settingsEventsReducer } from '$store/renderer/slices/settings-events/settings-events-slice';

/** Isolated component harness: production form reducer and workflow saga. */
export function createSettingsFormTestStore() {
  const initial = () => ({ settingsEvents: settingsEventsReducer(undefined, { type: '@@init' }) });
  let state = initial();
  const channel = stdChannel();
  const listeners = new Set<() => void>();
  const actions: { type: string }[] = [];
  const store = {
    get state() {
      return state;
    },
    actions,
    init() {
      state = initial();
      actions.length = 0;
      listeners.forEach((notify) => notify());
    },
    dispatch(action: { type: string }) {
      actions.push(action);
      state = { settingsEvents: settingsEventsReducer(state.settingsEvents, action as never) };
      channel.put(action);
      listeners.forEach((notify) => notify());
      return action;
    },
    createSelector<T, A extends unknown[]>(
      select: (state: ReturnType<typeof initial>, ...args: A) => T,
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
      const task = runSaga({ channel, dispatch: store.dispatch, getState: () => state }, saga);
      return () => task.cancel();
    },
  };
  return store;
}
