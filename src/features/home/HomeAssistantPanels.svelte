<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import Panel from '$lib/components/layout/panel-system/Panel.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { slide, type AxisMotionParams, type MotionTransitionConfig } from '$lib/motion';
  import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';
  import { store } from '$store/renderer/store';
  import {
    selectPanel,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    panelLayoutScopeMounted,
    panelLayoutScopeUnmounted,
    closeTab,
    closePanel,
    focusPanel,
    setActiveTab,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { writable } from 'svelte/store';
  import { ASSISTANT_CONTENT_PANEL_ID, selectAssistantPanelLayoutId } from './assistant-panels';
  import { observeHomePanelWidth } from './home-panel-width';

  let { children, isActive = true }: { children: Snippet; isActive?: boolean } = $props();
  let maxWidth = $state(Number.MAX_SAFE_INTEGER);
  const layoutId$ = selectAssistantPanelLayoutId();
  const layoutIdStore = writable($layoutId$);
  $effect(() => layoutIdStore.set($layoutId$));
  const panel$ = selectPanel(layoutIdStore, ASSISTANT_CONTENT_PANEL_ID);
  const focused$ = selectFocusedPanelId(layoutIdStore);
  const mountedLayouts = new Set<string>();
  $effect(() => {
    const id = $layoutId$;
    if (!mountedLayouts.has(id)) {
      mountedLayouts.add(id);
      store.dispatch(panelLayoutScopeMounted(id));
    }
  });
  onDestroy(() => {
    for (const id of mountedLayouts) store.dispatch(panelLayoutScopeUnmounted(id));
  });
  const hasContent = $derived(!!$panel$?.tabs.length);
  let retainedPanel = $state.raw<PanelState | null>(null);
  let retainedLayoutId = $state('');
  $effect(() => {
    if ($panel$?.tabs.length) {
      retainedPanel = $panel$;
      retainedLayoutId = $layoutId$;
    }
  });

  function expandContent(
    node: Element,
    params: AxisMotionParams,
    direction: { direction?: 'in' | 'out' | 'both' },
  ): MotionTransitionConfig {
    const stacked =
      node.parentElement && getComputedStyle(node.parentElement).flexDirection === 'column';
    return slide(node, { ...params, axis: stacked ? 'y' : 'x' }, direction);
  }
</script>

<div class="assistant-panels flex h-full min-h-0 min-w-0 flex-1" data-assistant-panels>
  <div class="assistant-chat home-panel min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
    {@render children()}
  </div>
  {#if hasContent && retainedPanel}
    <div
      class="assistant-content ml-3 min-h-0 min-w-0 shrink-0"
      data-assistant-content-panel
      use:observeHomePanelWidth={(width) => (maxWidth = width)}
      transition:expandContent={{ tier: 'moderate' }}
    >
      <ResizablePanel
        storageKey="assistant-content-width"
        side="right"
        minWidth={320}
        {maxWidth}
        defaultWidth={540}
        className="assistant-content-resizable h-full max-w-full home-panel bg-background"
        handleClassName="assistant-content-resize-handle"
      >
        <Panel
          panel={retainedPanel}
          workspaceId={CHIEF_WORKSPACE_ID}
          layoutId={retainedLayoutId}
          active={isActive && hasContent}
          contained
          canCreateColumn={false}
          isRightmostPanel
          isFocused={isActive && $focused$ === ASSISTANT_CONTENT_PANEL_ID}
          onFocus={() => store.dispatch(focusPanel(retainedLayoutId, ASSISTANT_CONTENT_PANEL_ID))}
          onTabClick={(id) =>
            store.dispatch(setActiveTab(retainedLayoutId, id, ASSISTANT_CONTENT_PANEL_ID))}
          onTabClose={(id) =>
            store.dispatch(closeTab(retainedLayoutId, id, ASSISTANT_CONTENT_PANEL_ID))}
          onClosePanel={() =>
            store.dispatch(closePanel(retainedLayoutId, ASSISTANT_CONTENT_PANEL_ID))}
        />
      </ResizablePanel>
    </div>
  {/if}
</div>

<style>
  .assistant-content {
    max-width: calc(100% - 0.75rem);
  }
  .assistant-content :global(.assistant-content-resizable) {
    min-width: 0 !important;
    max-width: 100% !important;
  }
  .assistant-content :global(.assistant-content-resize-handle) {
    left: -0.75rem;
    width: 0.75rem;
    clip-path: none;
  }
  @container home-layout (max-width: 900px) {
    .assistant-panels {
      flex-direction: column;
      overflow-y: auto;
    }
    .assistant-panels:has(> .assistant-content) .assistant-chat {
      flex: 1 0 20rem;
    }
    .assistant-content {
      margin-left: 0;
      margin-top: 0.75rem;
      max-width: 100%;
      flex: 0 0 auto;
      height: 24rem;
    }
    .assistant-content :global(.assistant-content-resizable) {
      width: 100% !important;
    }
    .assistant-content :global(.assistant-content-resize-handle) {
      display: none;
    }
  }
</style>
