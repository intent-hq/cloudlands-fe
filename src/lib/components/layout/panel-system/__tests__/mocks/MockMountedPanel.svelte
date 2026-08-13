<script lang="ts">
  import type { PanelState } from '$features/layout/panel-layout-adapter';

  let {
    panel,
    isFocused = false,
  }: {
    panel: PanelState;
    isFocused?: boolean;
  } = $props();
</script>

<div
  class="h-full w-full"
  data-mounted-panel={panel.id}
  data-active-tab={panel.activeTabId}
  data-focused={isFocused}
>
  {panel.tabs.find((tab) => tab.id === panel.activeTabId)?.title ?? ''}
</div>
