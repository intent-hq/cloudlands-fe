<script lang="ts">
  import { onDestroy } from 'svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import type {
    PanelTab,
    PanelTabType,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import PanelEmptyState from '../../PanelEmptyState.svelte';
  import PanelTabBar from '../../PanelTabBar.svelte';

  type IdentityType = PanelTabType | 'empty';

  let {
    identityType = 'agent',
    theme = 'light',
    width = 280,
    height = 320,
    zoom = 1,
    pinned = true,
    pinMode = true,
  }: {
    identityType?: IdentityType;
    theme?: 'light' | 'dark';
    width?: number;
    height?: number;
    zoom?: number;
    pinned?: boolean;
    pinMode?: boolean;
  } = $props();

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  registerAllTabTypes();
  onDestroy(disposeStore);

  const tab = $derived<PanelTab | null>(
    identityType === 'empty'
      ? null
      : {
          id: `${identityType}-identity-tab`,
          type: identityType,
          title: `${identityType} panel with a long identity title for narrow geometry`,
          closable: true,
          agentId: identityType === 'agent' ? 'panel-identity-agent' : undefined,
          noteId: identityType === 'note' ? 'panel-identity-note' : undefined,
          filePath: identityType === 'file' ? '/workspace/identity-file.ts' : undefined,
        },
  );
</script>

<section
  class:dark={theme === 'dark'}
  class="overflow-hidden bg-background text-foreground"
  style={`width: ${width}px; height: ${height}px; zoom: ${zoom}; container-type: size;`}
  data-testid="panel-header-identity-host"
  data-identity-type={identityType}
>
  <span class="invisible absolute text-sm" data-panel-body-copy-probe>Body copy</span>
  {#if tab}
    <PanelTabBar
      tabs={[tab]}
      activeTabId={tab.id}
      panelId="panel-identity"
      workspaceId="panel-identity-workspace"
      isFocused
      onTabRename={() => {}}
      onClosePanel={() => {}}
    />
  {:else}
    <PanelEmptyState
      workspaceId="panel-identity-workspace"
      panelId="panel-identity"
      onCreateAgent={() => {}}
      onCreateNote={() => {}}
      onCreateTerminal={() => {}}
      onOpenBrowser={() => {}}
    />
  {/if}
</section>
