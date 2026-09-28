<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PanelTab } from '$features/layout/panel-layout-adapter';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import PanelTabBar from '../../PanelTabBar.svelte';

  let {
    kind = 'note',
    canRename = true,
  }: { kind?: PanelTab['type'] | 'spec'; canRename?: boolean } = $props();
  const dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
  onDestroy(dispose);
  let title = $state('Original title');
  let renamed = $state('');
  let renameCount = $state(0);
  let selectionCount = $state(0);
  let zoomCount = $state(0);
  const tabs = $derived<PanelTab[]>([
    {
      id: 'active',
      type: kind === 'spec' ? 'note' : kind,
      title,
      noteId: kind === 'spec' ? 'spec' : undefined,
    },
    { id: 'other', type: 'note', title: 'Other note' },
  ]);
</script>

<div
  style="width: 480px"
  data-renamed={renamed}
  data-rename-count={renameCount}
  data-selection-count={selectionCount}
  data-zoom-count={zoomCount}
>
  <PanelTabBar
    {tabs}
    activeTabId="active"
    panelId="rename-panel"
    workspaceId="rename-fixture"
    onTabClick={() => selectionCount++}
    onZoomToggle={() => zoomCount++}
    onTabRename={canRename
      ? (tab, name) => {
          renamed = `${tab.id}:${name}`;
          title = name;
          renameCount++;
        }
      : undefined}
  />
</div>
