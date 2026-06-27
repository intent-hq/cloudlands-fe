import { getContext } from 'svelte';
import { type Readable } from 'svelte/store';
import type {
  NormalizedStoreOptions,
  PreloadedStoreState,
  ReducersMap,
  StoreMiddleware,
  StoreOptions,
  StoreReducerFunction,
  StoreSelector,
  StoreSelectorCallback,
  StoreStateFromStateMap,
  StoreStateMap,
} from './types';
import { combineReducers, createStoreCore, type StoreCore } from './internal/store-core.js';
import { createSelectorFromReadableState } from './internal/create-selector.js';

export type { StoreOptions } from './types';

export type StoreReducersInput<TStateMap extends StoreStateMap> = {
  [Domain in keyof TStateMap]: StoreReducerFunction<TStateMap[Domain]>;
};
export type StoreBoundState<TStateMap extends StoreStateMap> =
  StoreStateFromStateMap<TStateMap>;
export type StoreMiddlewareInput = StoreMiddleware | StoreMiddleware[];

const STORE_CONTEXT = 'redux-store-context';
const LIFECYCLE_OUTSIDE_COMPONENT_ERROR = 'lifecycle_outside_component';

const isLifecycleOutsideComponentError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.message.includes(LIFECYCLE_OUTSIDE_COMPONENT_ERROR)) return true;
  return error.cause instanceof Error && isLifecycleOutsideComponentError(error.cause);
};

const getStoreContext = (): { store: { dispatch: (action: any) => any } } | undefined => {
  try {
    return getContext(STORE_CONTEXT);
  } catch (error) {
    if (isLifecycleOutsideComponentError(error)) return undefined;
    throw error;
  }
};

export function getDispatch(): (action: any) => any {
  const context = getStoreContext();
  if (!context?.store)
    throw new Error('Missing redux store context. Wrap root component into <Store/>');
  return context.store.dispatch;
}

const normalizeOptions = (options: StoreOptions = {}): NormalizedStoreOptions => ({
  throttledSelectorFrequency: options.throttledSelectorFrequency ?? 64,
  sagaMonitor: options.sagaMonitor === true,
  traceSelectors: options.traceSelectors === true,
});

const toArray = (middleware?: StoreMiddlewareInput): StoreMiddleware[] => {
  if (!middleware) return [];
  return Array.isArray(middleware) ? [...middleware] : [middleware];
};

/**
 * Canonical Svelte-readable Store. Selectors return Svelte Readable values when
 * called and keep .select/.effect escape hatches for tests and sagas. This is a
 * redux/saga-free reimplementation of the toolkit Store surface the app uses.
 */
export class Store<
  TStateMap extends StoreStateMap = Record<string, never>,
  TReducers extends StoreReducersInput<TStateMap> = StoreReducersInput<TStateMap>,
> {
  private reducers: ReducersMap;
  private middlewares: StoreMiddleware[];
  protected readonly storeOptions: NormalizedStoreOptions;
  private storeCore: StoreCore | undefined;

  constructor(
    reducersMap?: TReducers & StoreReducersInput<TStateMap>,
    middleware?: StoreMiddlewareInput,
    options?: StoreOptions,
  ) {
    this.reducers = (reducersMap ?? {}) as unknown as ReducersMap;
    this.middlewares = toArray(middleware);
    this.storeOptions = normalizeOptions(options);
  }

  addMiddleware(middleware: StoreMiddlewareInput): void {
    this.middlewares = [...this.middlewares, ...toArray(middleware)];
  }

  getReducers(): TReducers {
    return this.reducers as unknown as TReducers;
  }

  private requireCore(): StoreCore {
    if (!this.storeCore)
      throw new Error('Cannot use the Store before Store.init() has been called.');
    return this.storeCore;
  }

  get state(): StoreBoundState<TStateMap> {
    return this.requireCore().getState();
  }

  get dispatch(): (action: any) => any {
    return (action: any) => this.requireCore().dispatch(action);
  }

  init(initialState?: PreloadedStoreState): () => void {
    if (this.storeCore) return () => {};
    const rootReducer = combineReducers(this.reducers);
    this.storeCore = createStoreCore(rootReducer, initialState, this.middlewares);
    return () => {
      this.dispose();
    };
  }

  createSelector<ARGS extends any[] = [], R = unknown>(
    selectorFunc: StoreSelectorCallback<R, ARGS, StoreBoundState<TStateMap>>,
  ): StoreSelector<R, ARGS, StoreBoundState<TStateMap>> {
    return createSelectorFromReadableState<R, ARGS, StoreBoundState<TStateMap>>(
      () => this.getReadableState(),
      selectorFunc,
    );
  }

  private getReadableStateInternal(): Readable<StoreBoundState<TStateMap>> {
    const core = this.requireCore();
    const get = () => core.getState() as StoreBoundState<TStateMap>;
    return {
      subscribe: (run: (value: StoreBoundState<TStateMap>) => void) => {
        run(get());
        return core.subscribe(() => run(get()));
      },
    };
  }

  getReadableState(): Readable<StoreBoundState<TStateMap>> {
    if (!this.storeCore)
      throw new Error('Cannot access Store.getReadableState() before Store.init() has been called.');
    return this.getReadableStateInternal();
  }

  initDevTool(): () => void {
    return () => {};
  }

  traceSelectors(): void {}

  runSaga(_saga: unknown): () => void {
    return () => {};
  }

  dispose(): void {
    this.storeCore = undefined;
  }
}
