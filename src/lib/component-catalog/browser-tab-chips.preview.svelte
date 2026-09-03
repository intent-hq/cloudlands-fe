<script lang="ts" module>
  import { definePreview } from './preview-definition';

  interface BrowserTabChipsPreviewProps {
    count: number;
    width: number;
  }

  export const preview = definePreview<BrowserTabChipsPreviewProps>({
    id: 'browser-tab-chips',
    title: 'Browser tabs in an agent header',
    defaultState: 'five-tabs',
    states: {
      'one-tab': { props: { count: 1, width: 640 } },
      'three-tabs': { props: { count: 3, width: 640 } },
      'five-tabs': { props: { count: 5, width: 640 } },
      narrow: { props: { count: 5, width: 380 } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import BrowserTabChips from '$lib/components/chat/BrowserTabChips.svelte';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { store } from '$store/renderer/store';
  import {
    clearPanelLayout,
    initializeLayout,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  let { count, width }: BrowserTabChipsPreviewProps = $props();
  const workspaceId = 'browser-tab-chips-preview';
  const agentId = 'browser-tab-chips-agent';
  const disposeStore = startRootStoreLifecycle(store, { startSagas: () => [] });
  const labels = ['Intent docs', 'Dashboard', 'Pull request', 'Long reference page', 'Preview'];

  $effect(() => {
    store.dispatch(
      initializeLayout(workspaceId, {
        root: { type: 'panel', panelId: 'browser-preview-panel' },
        panels: {
          'browser-preview-panel': {
            id: 'browser-preview-panel',
            activeTabId: 'agent-preview-tab',
            tabs: [
              {
                id: 'agent-preview-tab',
                type: 'agent',
                title: 'Agent',
                agentId,
                closable: true,
              },
              ...labels.slice(0, count).map((title, index) => ({
                id: `browser-preview-${index}`,
                type: 'browser' as const,
                title,
                browserUrl: `https://preview-${index}.example.test/`,
                ownerAgentId: agentId,
                closable: true,
              })),
            ],
          },
        },
        focusedPanelId: 'browser-preview-panel',
      }),
    );
  });

  onDestroy(() => {
    store.dispatch(clearPanelLayout(workspaceId));
    disposeStore();
  });
</script>

<section
  class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground shadow-sm"
  style:width={`${width}px`}
  data-browser-tab-chips-preview
  data-preview-count={count}
>
  <div
    class="flex h-10 min-w-0 items-center gap-2 border-b border-border px-2"
    data-panel-content-header
  >
    <span class="h-2.5 w-24 shrink rounded-full bg-muted"></span>
    <span class="min-w-0 flex-1"></span>
    <span class="flex min-w-0 items-center gap-1.5">
      <BrowserTabChips {workspaceId} {agentId} />
      <span class="size-6 shrink-0 rounded-md bg-muted/60"></span>
    </span>
  </div>
  <div class="h-24 bg-background/70"></div>
</section>
