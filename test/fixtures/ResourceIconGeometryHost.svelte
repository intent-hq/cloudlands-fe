<script lang="ts">
  import { onDestroy } from 'svelte';
  import PanelTabBar from '$lib/components/layout/panel-system/PanelTabBar.svelte';
  import ChatMessageNavigator from '$lib/components/chat/ChatMessageNavigator.svelte';
  import { registerAllTabTypes } from '$features/layout/tab-types/register-all';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import type { PanelTab } from '$store/renderer/slices/panel-layout/panel-layout-types';

  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  registerAllTabTypes();
  onDestroy(disposeStore);

  const scenarios = ['light', 'dark'].flatMap((theme) =>
    [280, 840].flatMap((width) =>
      [1, 2].flatMap((zoom) =>
        [320, 400, 600].flatMap((height) =>
          (['note', 'changes'] as const).map((type) => {
            const id = `${theme}-${width}-${zoom}-${height}-${type}`;
            return {
              id,
              theme,
              width,
              zoom,
              height,
              tab: {
                id: `tab-${id}`,
                type,
                title: type === 'note' ? 'Geometry note' : 'Geometry changes',
                noteId: type === 'note' ? `note-${id}` : undefined,
                closable: true,
                workspaceId: `workspace-${id}`,
              } as PanelTab,
            };
          }),
        ),
      ),
    ),
  );
</script>

{#snippet headerActions()}
  <ChatMessageNavigator
    messages={[{ id: 'message-1', text: 'Geometry message' }]}
    isAtBottom={false}
    onSelectMessage={() => true}
    onScrollToBottom={() => {}}
  />
{/snippet}

{#each scenarios as scenario (scenario.id)}
  <div
    class:dark={scenario.theme === 'dark'}
    data-resource-geometry-case={scenario.id}
    data-theme={scenario.theme}
    data-width={scenario.width}
    data-zoom={scenario.zoom}
    data-height={scenario.height}
    data-type={scenario.tab.type}
    style={`position: relative; width: ${scenario.width}px; height: ${scenario.height}px; zoom: ${scenario.zoom}; container-type: size;`}
  >
    <span
      class="pointer-events-none absolute size-px bg-muted text-muted-foreground"
      data-resource-semantic-probe
    ></span>
    <PanelTabBar
      tabs={[scenario.tab]}
      activeTabId={scenario.tab.id}
      panelId={`panel-${scenario.id}`}
      workspaceId={`workspace-${scenario.id}`}
      contentActions={{ primary: headerActions }}
      onClosePanel={() => {}}
      showTabStrip
    />
  </div>
{/each}
