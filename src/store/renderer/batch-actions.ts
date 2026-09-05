export interface ReduxAction {
  type: string;
  payload?: unknown;
  [key: string]: unknown;
}

interface ReducerWithInitialState {
  (state: any, action: ReduxAction): any;
  initialState: any;
}

const RENDERER_BATCH_ACTIONS = 'renderer/batchActions';

export function batchRendererActions(actions: ReduxAction[]): ReduxAction {
  return { type: RENDERER_BATCH_ACTIONS, payload: actions };
}

export function enableRendererActionBatching<T extends Record<string, ReducerWithInitialState>>(
  reducers: T,
): T {
  return Object.fromEntries(
    Object.entries(reducers).map(([name, reducer]) => {
      const batched = ((state: unknown, action: ReduxAction) => {
        if (action.type !== RENDERER_BATCH_ACTIONS) return reducer(state, action);
        return (action.payload as ReduxAction[]).reduce(reducer, state);
      }) as ReducerWithInitialState;
      Object.assign(batched, reducer, { initialState: reducer.initialState });
      return [name, batched];
    }),
  ) as T;
}
