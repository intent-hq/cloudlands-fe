<script lang="ts">
  import { untrack } from 'svelte';
  import PanelLayout from '$lib/components/layout/panel-system/PanelLayout.svelte';
  import { store as appStore } from '$store/renderer/store';
  import { getPanelOrder } from '$store/renderer/slices/panel-layout/panel-layout-tabless';
  import { selectPanelLayoutWorkspace } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import {
    bootstrapNewWorkspaceLayout,
    initializeLayout,
    resolveNewWorkspaceInitialAgent,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';

  let {
    coordinator = true,
    delayed = false,
    restore = false,
    scenario = 'default',
  }: {
    coordinator?: boolean;
    delayed?: boolean;
    restore?: boolean;
    scenario?: string;
  } = $props();

  appStore.init();
  const initialCoordinator = untrack(() => coordinator);
  const initialDelayed = untrack(() => delayed);
  const initialRestore = untrack(() => restore);
  const layoutId = `initial-agent-${untrack(() => scenario)}`;
  appStore.dispatch(
    bootstrapNewWorkspaceLayout(
      layoutId,
      initialDelayed ? null : 'agent-initial',
      'Initial agent',
      initialCoordinator,
    ),
  );
  if (initialDelayed) {
    appStore.dispatch(
      resolveNewWorkspaceInitialAgent(layoutId, 'agent-initial', 'Initial agent', 10),
    );
    appStore.dispatch(
      resolveNewWorkspaceInitialAgent(layoutId, 'agent-late', 'Late duplicate', 20),
    );
  }
  if (initialRestore) {
    const created = selectPanelLayoutWorkspace.select(appStore.state, layoutId);
    appStore.dispatch(
      initializeLayout(layoutId, {
        root: created.root,
        panels: created.panels,
        focusedPanelId: created.focusedPanelId,
        deferSpecTab: created.deferSpecTab,
        newWorkspaceLifecycle: created.newWorkspaceLifecycle,
      }),
    );
  }

  const layout = selectPanelLayoutWorkspace.select(appStore.state, layoutId);
  const order = getPanelOrder(layout.root);
  const agentPanels = Object.values(layout.panels).filter((panel) =>
    panel.tabs.some((tab) => tab.agentId === 'agent-initial'),
  );
  const agentPanel = agentPanels[0];
  const reusablePanel = order.map((id) => layout.panels[id]).find((panel) => panel?.pristine);
</script>

<output
  data-initial-agent-state
  data-agent-count={agentPanels.length}
  data-agent-panel-id={agentPanel?.id ?? ''}
  data-focused-panel-id={layout.focusedPanelId ?? ''}
  data-reusable-panel-id={reusablePanel?.id ?? ''}
  data-panel-order={order.join(',')}
></output>
<div class="h-[520px] w-[1200px]">
  <PanelLayout workspaceId={layoutId} {layoutId} contained canvasSizing="content" />
</div>
