<script lang="ts">
  import { Tooltip as TooltipPrimitive } from 'bits-ui';
  import { onDestroy } from 'svelte';
  import WindowTitleBar from '$lib/components/layout/WindowTitleBar.svelte';
  import ChiefCard from '$lib/components/layout/sidebar-nav/cards/ChiefCard.svelte';
  import { page } from '$app/state';
  import { selectPanelItem } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
  import { store } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { openWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { admitLegacyPrincipal } from '../../src/test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';

  const TooltipProvider = TooltipPrimitive.Provider;
  let { withAssistant = false }: { withAssistant?: boolean } = $props();
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  const panelItem$ = selectPanelItem();
  // No principal hydration saga runs here. Model the admitted legacy owner
  // whose workspace launcher is measured, without relaxing production guards.
  const previousPrincipal = store.state.principal;
  admitLegacyPrincipal();
  store.dispatch(guestSessionsListUnavailable());
  store.dispatch(openWorkspaceTab('titlebar-test'));
  onDestroy(() => {
    store.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      store.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
    dispose();
  });
</script>

<TooltipProvider>
  <WindowTitleBar />
  {#if withAssistant && page.url.pathname === '/' && $panelItem$ === 'chief'}
    <main class="h-[480px]" data-home-assistant>
      <ChiefCard />
    </main>
  {/if}
</TooltipProvider>
