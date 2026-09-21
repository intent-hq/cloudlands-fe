<script lang="ts">
  import EmbeddedBrowser from '$lib/components/browser/EmbeddedBrowser.svelte';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';
  let { tab, workspaceId, isActive }: { tab: PanelTab; workspaceId: string; isActive: boolean } =
    $props();
</script>

<!-- Production Panel owns mounting/cache; production EmbeddedBrowser owns the guest. -->
<EmbeddedBrowser
  url={tab.browserUrl!}
  {workspaceId}
  tabId={tab.id}
  {isActive}
  ownerAgentId={tab.ownerAgentId}
/>
