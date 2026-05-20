type AppStoreMockOptions = {
  state?: unknown | (() => unknown);
  dispatch?: (...args: any[]) => unknown;
};
type StoreReadableStateSource = {
  state?: unknown;
  getReadableState?: () => { subscribe: (listener: (state: any) => void) => () => void };
};

const noop = () => {};
const readable = <T>(getter: () => T) => ({
  subscribe: (listener: (value: T) => void) => {
    listener(getter());
    return noop;
  },
});

const resolveState = (state: AppStoreMockOptions['state']) =>
  typeof state === 'function' ? (state as () => unknown)() : (state ?? {});

export const createStoreMockModule = <TStore extends object>(appStore: TStore) => ({
  appStore,
  store: appStore,
});

export const createAppStoreMock = ({
  state,
  dispatch,
}: AppStoreMockOptions = {}) => {
  const appStore = {
    get state() {
      return resolveState(state);
    },
    dispatch: (...args: any[]) => (dispatch ?? noop)(...args),
    getReadableState: () => readable(() => appStore.state),
    createSelector: (selectorFunc: (state: any, ...args: any[]) => any) => {
      const selector = Object.assign(
        (...args: any[]) => readable(() => selectorFunc(appStore.state, ...args)),
        {
          select: selectorFunc,
          effect: (...args: any[]) => selectorFunc(appStore.state, ...args),
          withStore: (storeSource: StoreReadableStateSource) =>
            (...args: any[]) => readable(() => selectorFunc(storeSource.state ?? appStore.state, ...args)),
        },
      );

      return selector;
    },
  };

  return appStore;
};

export const createAppStoreMockModule = (options?: AppStoreMockOptions) =>
  createStoreMockModule(createAppStoreMock(options));
