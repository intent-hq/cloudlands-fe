<script lang="ts" module>
  import {
  setContext,
  onDestroy,
  type Snippet,
} from 'svelte';
  import { initAppStore } from '../init';
  import { type PreloadedStoreState } from '../types';
  import { STORE_CONTEXT } from '../constants';
  import { getStoreContext } from '../utils/svelte-context';
  import { startAllAppSagas } from '../store';

  export function initStore(initialState?: PreloadedStoreState): () => void {
    const existingStoreContext = getStoreContext();
    if (existingStoreContext) {
      return () => {};
    }

    const storeContext = initAppStore(initialState);

    // Start all registered app sagas through the configured package Store API.
    const stopHandlers = startAllAppSagas();

    setContext(STORE_CONTEXT, storeContext);

    return () => {
      setContext(STORE_CONTEXT, null);
      for (const stop of stopHandlers) {
        stop();
      }
      storeContext.dispose();
    };
  }
</script>

<script lang="ts">


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
