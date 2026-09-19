import { shallowEqual } from 'fast-equals';

type AppStoreMockOptions = {
  state?: unknown | (() => unknown);
  dispatch?: (...args: any[]) => unknown;
  /**
   * When true, `emitState()` re-notifies a readable only if its selected value
   * is no longer shallow-equal to the last value it delivered, mirroring the
   * Themis selector stream's `skipDuplicates(shallowEqual)`. Use it when a
   * test must prove a component anchors on the right selector: the default
   * re-notify-everything mode masks a missing reactivity dependency.
   */
  dedupeEmits?: boolean;
  reducers?: Record<string, (state: any, action: any) => any>;
};
type StoreReadableStateSource = {
  state?: unknown;
  getReadableState?: () => { subscribe: (listener: (state: any) => void) => () => void };
};

const noop = () => {};

const resolveState = (state: AppStoreMockOptions['state']) =>
  typeof state === 'function' ? (state as () => unknown)() : (state ?? {});

// Mirror the real Themis selector runtime, which unwraps svelte-store args
// (readReadableArg) before calling the selector function with plain values.
const isReadable = (arg: unknown): arg is { subscribe: (l: (v: unknown) => void) => unknown } =>
  !!arg &&
  typeof arg === 'object' &&
  'subscribe' in arg &&
  typeof (arg as { subscribe: unknown }).subscribe === 'function';

const readReadableArg = (arg: unknown): unknown => {
  if (!isReadable(arg)) return arg;
  let value: unknown;
  const unsubscribe = arg.subscribe((v) => {
    value = v;
  });
  if (typeof unsubscribe === 'function') unsubscribe();
  return value;
};

export const createStoreMockModule = <TStore extends object>(appStore: TStore) => ({
  appStore,
  store: appStore,
});

export const createAppStoreMock = ({
  state,
  dispatch,
  dedupeEmits = false,
  reducers = {},
}: AppStoreMockOptions = {}) => {
  // Live subscribers to the mock's readables; `emitState()` re-notifies them
  // all so tests can simulate a store-state change after mutating the state
  // source (e.g. clearing a seeded slice).
  const listeners = new Set<() => void>();
  const reducerState: Record<string, any> = {};
  const touchedReducerFields: Record<string, Set<string>> = {};
  let reducerGeneration = 0;
  const externalState = () => {
    const value = resolveState(state);
    return value && typeof value === 'object' ? (value as Record<string, any>) : {};
  };
  for (const [key, reducer] of Object.entries(reducers)) {
    reducerState[key] = reducer(undefined, { type: '@@test/init' });
    touchedReducerFields[key] = new Set();
  }
  const currentState = () => {
    const external = externalState();
    const combined = { ...external };
    for (const [key, reduced] of Object.entries(reducerState)) {
      const externalSlice = external[key];
      const slice = {
        ...reduced,
        ...(externalSlice && typeof externalSlice === 'object' ? externalSlice : {}),
      };
      for (const field of touchedReducerFields[key]) slice[field] = reduced[field];
      combined[key] = slice;
    }
    return combined;
  };
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const reduce = (action: any) => {
    const before = currentState();
    for (const [key, reducer] of Object.entries(reducers)) {
      const current = before[key];
      const next = reducer(current, action);
      reducerState[key] = next;
      if (!next || typeof next !== 'object') continue;
      for (const field of Object.keys(next)) {
        if (next[field] !== current?.[field]) touchedReducerFields[key].add(field);
      }
    }
    notify();
  };
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      let last = getter();
      listener(last);
      const notify = () => {
        const next = getter();
        if (dedupeEmits && shallowEqual(last, next)) return;
        last = next;
        listener(next);
      };
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  });
  const appStore = {
    get state() {
      return currentState();
    },
    dispatch: (action: any, ...args: any[]) => {
      reduce(action);
      const result = (dispatch ?? noop)(action, ...args) as any;
      if (
        result?.promise &&
        result.promise !== action.promise &&
        typeof action.success === 'function' &&
        typeof action.failure === 'function'
      ) {
        const generation = reducerGeneration;
        void action.promise?.catch(() => {});
        void Promise.resolve(result.promise).then(
          (response) => {
            if (generation === reducerGeneration) reduce(action.success(response));
          },
          (error) => {
            if (generation === reducerGeneration)
              reduce(action.failure(error instanceof Error ? error : new Error(String(error))));
          },
        );
      }
      return result;
    },
    emitState: notify,
    resetReducers: () => {
      reducerGeneration += 1;
      for (const [key, reducer] of Object.entries(reducers)) {
        reducerState[key] = reducer(undefined, { type: '@@test/init' });
        touchedReducerFields[key].clear();
      }
      notify();
    },
    getReadableState: () => readable(() => appStore.state),
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) => {
      const selector = Object.assign(
        (...args: any[]) =>
          readable(() => selectorFunc(appStore.state, ...args.map(readReadableArg))),
        {
          select: selectorFunc,
          effect: function* (..._args: any[]): Generator<any, any, any> {
            throw new Error('selector.effect is unavailable: the saga runtime has been removed.');
          },
          withStore:
            (storeSource: StoreReadableStateSource) =>
            (...args: any[]) =>
              readable(() =>
                selectorFunc(storeSource.state ?? appStore.state, ...args.map(readReadableArg)),
              ),
        },
      );

      return selector;
    },
  };

  return appStore;
};

export const createAppStoreMockModule = (options?: AppStoreMockOptions) =>
  createStoreMockModule(createAppStoreMock(options));
