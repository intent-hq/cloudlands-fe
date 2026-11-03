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
  import { Button } from '$lib/components/ui/button';
  import TrafficInspector from './TrafficInspector.svelte';
  import DaemonLinksView from './DaemonLinksView.svelte';
  import {
    createDaemonLinksFeed,
    type DaemonLinksFeed,
    type DaemonLinksState,
  } from './daemon-links-feed';
  let { connect = connectDevConsole }: { connect?: typeof connectDevConsole } = $props();
  type ConsoleView = 'app' | 'links';
  const views: ConsoleView[] = ['app', 'links'];
  let view = $state<ConsoleView>('app');
  let linksState = $state.raw<DaemonLinksState | null>(null);
  let feed = $state.raw<DaemonLinksFeed>();
  // Shown only when the console's daemon advertises remoteLinkTraffic: 1.
  const linksAvailable = $derived(linksState?.supported === true);
  const shown = $derived(linksAvailable ? view : 'app');
  $effect(() => {
    feed?.setVisible(shown === 'links');
  });
  const viewLabel = (value: ConsoleView) =>
    value === 'app' ? m.devConsole_appTraffic_label() : m.devConsole_daemonLinks_label();
  function selectView(next: ConsoleView, focus = false) {
    view = next;
    if (focus) document.getElementById(`console-view-${next}`)?.focus();
  }

  // Isolated windows resolve the system locale without booting app preferences.
  applyLanguagePreference('system');

  // Dedicated Redux context: no normal app seeders, sagas, or daemon connection.
  const store = new Store({ devConsole: devConsoleReducer });
  const dispose = store.init();
  const state$ = store.createSelector((state) => state.devConsole)();
  let bridge = $state<ReturnType<typeof connectDevConsole>>();
  onDestroy(() => {
    feed?.dispose();
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
    feed = createDaemonLinksFeed(bridge.links, (next) => {
      linksState = next;
    });
  });
</script>

<main data-dev-console-ready={$state$.update !== null}>
  <ScreenHeader class="px-3 py-1 min-h-0">
    {#snippet title()}<h1>{m.devConsole_title_label()}</h1>{/snippet}
    {#snippet actions()}{#if linksAvailable}<div
          role="tablist"
          aria-label={m.devConsole_views_label()}
          class="views"
        >
          {#each views as value (value)}<Button
              size="compact"
              variant="ghost"
              wrapContent={false}
              class="view-control"
              role="tab"
              id={`console-view-${value}`}
              aria-controls={`console-panel-${value}`}
              aria-selected={shown === value}
              tabindex={shown === value ? 0 : -1}
              onclick={() => selectView(value)}
              onkeydown={(event) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                  event.preventDefault();
                  const next =
                    event.key === 'Home'
                      ? views[0]
                      : event.key === 'End'
                        ? views[views.length - 1]
                        : views[(views.indexOf(shown) + 1) % views.length];
                  selectView(next, true);
                }
              }}>{viewLabel(value)}</Button
            >{/each}
        </div>{/if}{/snippet}
  </ScreenHeader>
  <ScreenBody class="p-0 overflow-hidden">
    <!-- Both views stay mounted so switching keeps filters, selection and scroll. -->
    <div
      class="view"
      id="console-panel-app"
      role={linksAvailable ? 'tabpanel' : undefined}
      aria-labelledby={linksAvailable ? 'console-view-app' : undefined}
      hidden={shown !== 'app'}
    >
      <TrafficInspector consoleState={$state$} {bridge} />
    </div>
    {#if linksAvailable && linksState && feed}<div
        class="view"
        id="console-panel-links"
        role="tabpanel"
        aria-labelledby="console-view-links"
        hidden={shown !== 'links'}
      >
        <DaemonLinksView {linksState} {feed} />
      </div>{/if}
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
  .view {
    height: 100%;
    min-height: 0;
  }
  .view[hidden] {
    display: none;
  }
  .views {
    display: flex;
    font:
      11px ui-monospace,
      SFMono-Regular,
      Menlo,
      monospace;
  }
  .views :global(.view-control) {
    font: inherit;
    height: auto;
    min-height: 0;
    padding: 4px 10px;
    border-radius: 3px;
  }
  .views :global([aria-selected='true']) {
    box-shadow: inset 0 -2px hsl(var(--ring));
    background: hsl(var(--accent));
  }
</style>
