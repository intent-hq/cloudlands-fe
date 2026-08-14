<script lang="ts">
  import type { PanelState } from '$features/layout/panel-layout-adapter';
  import { Button } from '$lib/components/ui/button';

  let {
    panel,
    isFocused = false,
    onFocus,
  }: {
    panel: PanelState;
    isFocused?: boolean;
    onFocus?: () => void;
  } = $props();
</script>

<div
  class="h-full w-full"
  data-mounted-panel={panel.id}
  data-active-tab={panel.activeTabId}
  data-focused={isFocused}
>
  {panel.tabs.find((tab) => tab.id === panel.activeTabId)?.title ?? ''}
  <Button variant="plain" data-panel-interaction onclick={onFocus}>Focus panel</Button>
</div>
