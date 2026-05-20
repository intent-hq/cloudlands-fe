type AppStoreMockOptions = {
  state?: unknown | (() => unknown);
  dispatch?: (...args: any[]) => unknown;
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
}: AppStoreMockOptions = {}) => ({
  get state() {
    return resolveState(state);
  },
  dispatch: (...args: any[]) => (dispatch ?? noop)(...args),
  getReadableState: () => ({
    subscribe: (listener: () => void) => {
      listener();
      return noop;
    },
  }),
});

export const createAppStoreMockModule = (options?: AppStoreMockOptions) =>
  createStoreMockModule(createAppStoreMock(options));