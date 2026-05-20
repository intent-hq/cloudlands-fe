type StoreMockSource = {
  getState?: () => unknown;
  dispatch?: (...args: any[]) => unknown;
  subscribe?: (listener: () => void) => () => void;
};

type AppStoreMockOptions = {
  state?: unknown | (() => unknown);
  dispatch?: (...args: any[]) => unknown;
  getLegacyStore?: () => StoreMockSource | undefined;
};

const noop = () => {};

const resolveState = (state: AppStoreMockOptions['state']) =>
  typeof state === 'function' ? (state as () => unknown)() : (state ?? {});

export const createStoreMockModule = <TStore extends object>(appStore: TStore) => ({
  appStore,
  store: appStore,
});

export const createAppStoreMock = ({
  state,
  dispatch,
  getLegacyStore,
}: AppStoreMockOptions = {}) => ({
  get state() {
    return getLegacyStore?.()?.getState?.() ?? resolveState(state);
  },
  dispatch: (...args: any[]) => (dispatch ?? getLegacyStore?.()?.dispatch ?? noop)(...args),
  getReadableState: () => ({
    subscribe: (listener: () => void) => {
      listener();
      return getLegacyStore?.()?.subscribe?.(listener) ?? noop;
    },
  }),
});

export const createAppStoreMockModule = (options?: AppStoreMockOptions) =>
  createStoreMockModule(createAppStoreMock(options));