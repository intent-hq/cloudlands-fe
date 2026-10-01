<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Store } from '@themislib/themis/svelte-store';
  import {
    devConsoleReducer,
    consoleUpdated,
    consoleFailed,
    consoleReset,
  } from '$store/renderer/dev-console/dev-console-slice';
  import { connectDevConsole } from '$store/renderer/dev-console/dev-console-bridge';
  import * as m from '$shared/paraglide/messages.js';

  // Dedicated Redux context: no normal app seeders, sagas, or daemon connection.
  const store = new Store({ devConsole: devConsoleReducer });
  const dispose = store.init();
  const state$ = store.createSelector((state) => state.devConsole)();
  let bridge: ReturnType<typeof connectDevConsole> | undefined;
  onDestroy(() => {
    bridge?.dispose();
    store.dispatch(consoleReset());
    dispose();
  });
  onMount(() => {
    document.getElementById('splash')?.remove();
    document.getElementById('app-drag-region')?.remove();
    bridge = connectDevConsole(
      (update) => store.dispatch(consoleUpdated(update)),
      (error) => store.dispatch(consoleFailed(error)),
    );
  });
</script>

<main data-dev-console-ready={$state$.update !== null}>
  <h1>{m.devConsole_title_label()}</h1>
  {#if $state$.error}<p role="alert">{$state$.error}</p>{/if}
  {#if $state$.update}<p>{$state$.update.backendId}</p>{/if}
</main>
