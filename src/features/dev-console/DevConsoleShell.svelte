<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { applyLanguagePreference } from '$lib/i18n/locale';
  import { ScreenHeader, ScreenBody } from '$lib/components/patterns/screen';
  import { Store } from '@themislib/themis/svelte-store';
  import {
    devConsoleReducer,
    consoleUpdated,
    consoleFailed,
    consoleReset,
  } from '$store/renderer/dev-console/dev-console-slice';
  import { connectDevConsole } from '$store/renderer/dev-console/dev-console-bridge';
  import * as m from '$shared/paraglide/messages.js';
  import TrafficInspector from './TrafficInspector.svelte';
  let { connect = connectDevConsole }: { connect?: typeof connectDevConsole } = $props();

  // Isolated windows resolve the system locale without booting app preferences.
  applyLanguagePreference('system');

  // Dedicated Redux context: no normal app seeders, sagas, or daemon connection.
  const store = new Store({ devConsole: devConsoleReducer });
  const dispose = store.init();
  const state$ = store.createSelector((state) => state.devConsole)();
  let bridge = $state<ReturnType<typeof connectDevConsole>>();
  onDestroy(() => {
    bridge?.dispose();
    store.dispatch(consoleReset());
    dispose();
  });
  onMount(() => {
    document.getElementById('splash')?.remove();
    document.getElementById('app-drag-region')?.remove();
    bridge = connect(
      (update) => store.dispatch(consoleUpdated(update)),
      (error) => store.dispatch(consoleFailed(error)),
    );
  });
</script>

<main data-dev-console-ready={$state$.update !== null}>
  <ScreenHeader class="px-3 py-1 min-h-0">
    {#snippet title()}<h1>{m.devConsole_title_label()}</h1>{/snippet}
  </ScreenHeader>
  <ScreenBody class="p-0 overflow-hidden">
    <TrafficInspector consoleState={$state$} {bridge} />
  </ScreenBody>
</main>

<style>
  main {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  h1 {
    font-size: 13px;
    font-weight: 600;
  }
</style>
