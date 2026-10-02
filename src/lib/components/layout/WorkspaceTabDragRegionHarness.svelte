<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { page } from '$app/state';
  import { store } from '$store/renderer/configured-store';
  import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { openPanel, setPanelWidth } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

  let {
    sidebarWidth = 288,
    admittedOwner = false,
  }: { sidebarWidth?: number; admittedOwner?: boolean } = $props();
  const previousPrincipal = untrack(() => {
    const previous = store.state.principal;
    if (admittedOwner) admitLegacyPrincipal();
    else store.dispatch(principalContextChanged(null));
    return previous;
  });
  onDestroy(() => {
    store.dispatch(principalContextChanged(previousPrincipal.context));
    if (previousPrincipal.context && previousPrincipal.snapshot)
      store.dispatch(
        principalReceived(
          { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
          previousPrincipal.snapshot,
        ),
      );
  });
  const currentWorkspaceTabId$ = selectCurrentWorkspaceTabId();

  Object.assign(page, {
    url: new URL('http://localhost/workspace/geometry-gamma'),
    params: { id: 'geometry-gamma' },
  });
  $effect(() => {
    store.dispatch(openPanel('all-workspaces'));
    store.dispatch(setPanelWidth(sidebarWidth));
  });
</script>

<WorkspaceTabStripGeometryPreview activeWorkspaceId="geometry-gamma" fullTitlebar />
<output data-selected-workspace>{$currentWorkspaceTabId$}</output>
