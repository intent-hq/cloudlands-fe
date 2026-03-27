<script lang="ts" module>
  import { setContext } from 'svelte';
  import { init } from '../init';
  import { type PreloadedStoreState } from '../types';
  import { STORE_CONTEXT } from '../constants';
  import { getStoreContext } from '../utils/utils';
  import { sagaNames } from '../sagas';
  import { runSaga } from './run-saga';

  export function initStore(initialState?: PreloadedStoreState): () => void {
    const existingStoreContext = getStoreContext();
    if (existingStoreContext) {
      return () => {};
    }

    const storeContext = init(initialState);

    // Start all registered sagas synchronously to avoid race conditions
    const stopHandlers = sagaNames.map((name) => runSaga(storeContext.store, name));

    setContext(STORE_CONTEXT, storeContext);

    return () => {
      for (const stop of stopHandlers) {
        stop();
      }
      storeContext.dispose();
    };
  }
</script>

<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';

  const {
    initialState,
    children,
  }: {
    initialState?: PreloadedStoreState;
    children: Snippet;
  } = $props();

  const dispose = initStore(initialState);

  onDestroy(dispose);
</script>

{@render children?.()}
