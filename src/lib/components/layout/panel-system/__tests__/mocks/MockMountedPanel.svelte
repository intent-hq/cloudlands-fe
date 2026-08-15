<script lang="ts">
  import type { PanelState } from '$features/layout/panel-layout-adapter';
  import { Button } from '$lib/components/ui/button';

  let {
    panel,
    isFocused = false,
    onFocus,
    onClosePanel,
    onTabClose,
  }: {
    panel: PanelState;
    isFocused?: boolean;
    onFocus?: () => void;
    onClosePanel?: () => void;
    onTabClose?: (tabId: string) => void;
  } = $props();
</script>

<div
  class:bg-transparent={panel.pristine === true && panel.tabs.length === 0}
  class:bg-card={panel.pristine !== true || panel.tabs.length > 0}
  class="h-full w-full"
  data-mounted-panel={panel.id}
  data-active-tab={panel.activeTabId}
  data-focused={isFocused}
>
  {panel.tabs.find((tab) => tab.id === panel.activeTabId)?.title ?? ''}
  <Button variant="plain" data-panel-interaction onclick={onFocus}>Focus panel</Button>
  <Button variant="plain" data-panel-close onclick={onClosePanel}>Close panel</Button>
  <Button
    variant="plain"
    data-tab-close
    onclick={() => panel.activeTabId && onTabClose?.(panel.activeTabId)}
  >
    Close tab
  </Button>
</div>
