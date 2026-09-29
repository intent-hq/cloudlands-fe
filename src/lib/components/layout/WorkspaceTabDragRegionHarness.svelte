<script lang="ts">
  import { page } from '$app/state';
  import { store } from '$store/renderer/configured-store';
  import { selectCurrentWorkspaceTabId } from '$store/renderer/slices/tab-state/tab-state-selectors';
  import { openPanel, setPanelWidth } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
  import WorkspaceTabStripGeometryPreview from './workspace-tab-strip-geometry.preview.svelte';

  let { sidebarWidth = 288 }: { sidebarWidth?: number } = $props();
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
