<script lang="ts">
  import type { PanelState, PanelTab } from '$features/layout/panel-layout-adapter';

  let {
    panel,
    onTabRename,
  }: {
    panel: PanelState;
    onTabRename?: (tab: PanelTab, newName: string) => void;
  } = $props();
</script>

<div data-panel-id={panel.id}>
  {#each panel.tabs as tab (tab.id)}
    <button
      type="button"
      data-tab-id={tab.id}
      data-tab-title={tab.title}
      onclick={() => onTabRename?.(tab, 'New Title')}>{tab.title}</button
    >
  {/each}
</div>
