type AppStoreMockOptions = {
  state?: unknown | (() => unknown);
  dispatch?: (...args: any[]) => unknown;
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

export const createAppStoreMock = ({ state, dispatch }: AppStoreMockOptions = {}) => {
  // Live subscribers to the mock's readables; `emitState()` re-notifies them
  // all so tests can simulate a store-state change after mutating the state
  // source (e.g. clearing a seeded slice).
  const listeners = new Set<() => void>();
  const readable = <T>(getter: () => T) => ({
    subscribe: (listener: (value: T) => void) => {
      listener(getter());
      const notify = () => listener(getter());
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
  });
  const appStore = {
    get state() {
      return resolveState(state);
    },
    dispatch: (...args: any[]) => (dispatch ?? noop)(...args),
    emitState: () => {
      for (const notify of [...listeners]) notify();
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
