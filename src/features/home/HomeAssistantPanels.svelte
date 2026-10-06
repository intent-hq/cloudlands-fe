<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import Panel from '$lib/components/layout/panel-system/Panel.svelte';
  import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte';
  import { store } from '$store/renderer/store';
  import {
    selectPanel,
    selectFocusedPanelId,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    closeTab,
    closePanel,
    focusPanel,
    setActiveTab,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import { ASSISTANT_CONTENT_PANEL_ID } from './assistant-panels';

  let { children, isActive = true }: { children: Snippet; isActive?: boolean } = $props();
  const panel$ = selectPanel(CHIEF_WORKSPACE_ID, ASSISTANT_CONTENT_PANEL_ID);
  const focused$ = selectFocusedPanelId(CHIEF_WORKSPACE_ID);
  const hasContent = $derived(!!$panel$?.tabs.length);
</script>

<div class="assistant-panels flex h-full min-h-0 min-w-0 flex-1 gap-3" data-assistant-panels>
  <div class="assistant-chat home-panel min-h-0 min-w-0 flex-1 overflow-hidden bg-background">
    {@render children()}
  </div>
  {#if hasContent && $panel$}
    <div class="assistant-content min-h-0 min-w-0 shrink-0" data-assistant-content-panel>
      <ResizablePanel
        storageKey="assistant-content-width"
        side="right"
        minWidth={320}
        maxWidth={900}
        defaultWidth={540}
        className="assistant-content-resizable h-full max-w-full home-panel bg-background"
        handleClassName="assistant-content-resize-handle"
      >
        <Panel
          panel={$panel$}
          workspaceId={CHIEF_WORKSPACE_ID}
          layoutId={CHIEF_WORKSPACE_ID}
          active={isActive}
          contained
          canCreateColumn={false}
          isRightmostPanel
          isFocused={isActive && $focused$ === ASSISTANT_CONTENT_PANEL_ID}
          onFocus={() => store.dispatch(focusPanel(CHIEF_WORKSPACE_ID, ASSISTANT_CONTENT_PANEL_ID))}
          onTabClick={(id) =>
            store.dispatch(setActiveTab(CHIEF_WORKSPACE_ID, id, ASSISTANT_CONTENT_PANEL_ID))}
          onTabClose={(id) =>
            store.dispatch(closeTab(CHIEF_WORKSPACE_ID, id, ASSISTANT_CONTENT_PANEL_ID))}
          onClosePanel={() =>
            store.dispatch(closePanel(CHIEF_WORKSPACE_ID, ASSISTANT_CONTENT_PANEL_ID))}
        />
      </ResizablePanel>
    </div>
  {/if}
</div>

<style>
  .assistant-content {
    max-width: 60%;
  }
  .assistant-content :global(.assistant-content-resize-handle) {
    left: -0.75rem;
    width: 0.75rem;
  }
  @container home-layout (max-width: 900px) {
    .assistant-panels {
      flex-direction: column;
      overflow-y: auto;
    }
    .assistant-chat {
      flex: 1 0 20rem;
    }
    .assistant-content {
      max-width: 100%;
      flex: 1 0 24rem;
    }
    .assistant-content :global(.assistant-content-resizable) {
      width: 100% !important;
    }
    .assistant-content :global(.assistant-content-resize-handle) {
      display: none;
    }
  }
</style>
