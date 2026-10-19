<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { admitLegacyPrincipal } from '../../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { page } from '$app/state';
  import { store } from '$store/renderer/configured-store';
  import { loadWorkspaceTabsState } from '$store/renderer/slices/tab-state/tab-state-slice';
  import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
  import { WorkspaceStatus } from '$shared/types';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

  const timestamp = '2026-09-01T12:00:00.000Z';
  const restoredIds = Array.from({ length: 10 }, (_, index) => `restored-${index + 1}`);
  const previousPrincipal = untrack(() => {
    const previous = store.state.principal;
    admitLegacyPrincipal();
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
  for (const [index, id] of restoredIds.entries()) {
    store.dispatch(
      setWorkspaceEntity({
        id: WorkspaceId(id),
        title: `Restored workspace ${index + 1}`,
        branch: id,
        changesets: [],
        timeline: [],
        conversationInfo: [],
        status: WorkspaceStatus.Active,
        createdAt: timestamp,
        updatedAt: timestamp,
      }),
    );
  }

  Object.assign(page, {
    url: new URL('http://localhost/workspace/geometry-gamma'),
    params: { id: 'geometry-gamma' },
  });

  function restoreTabs() {
    store.dispatch(
      loadWorkspaceTabsState({
        openTabs: restoredIds,
        currentTabId: restoredIds[0],
        pinnedTabs: [],
        unsavedTabs: [],
        optimisticTabs: [],
        tabOrder: restoredIds,
      }),
    );
  }
</script>

<WorkspaceTabStripGeometryPreview
  activeWorkspaceId="geometry-gamma"
  initialOpenWorkspaceIds={['geometry-gamma']}
  fullTitlebar
/>
<!-- i18n-ignore (component test harness control) -->
<button type="button" onclick={restoreTabs} data-restore-tabs>Restore tabs</button>
