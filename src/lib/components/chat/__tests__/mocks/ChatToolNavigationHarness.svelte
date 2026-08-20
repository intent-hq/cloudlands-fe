<script module lang="ts">
  import type { RootStoreHmrData } from '$store/renderer/root-store-lifecycle';

  const storeLifecycleData: RootStoreHmrData = {};
</script>

<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ToolCall from '../../ToolCall.svelte';
  import ToolDetails from '../../ToolDetails.svelte';
  import { installChatToolNavigationIpcMock } from './chat-tool-navigation-ipc-mock';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { store as appStore } from '$store/renderer/store';
  import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
  import { panelLayoutSaga } from '$store/renderer/slices/panel-layout/sagas/panel-layout-saga';
  import { workspaceNavigationTabSaga } from '$store/renderer/slices/workspace-navigation/sagas/workspace-navigation-tab-saga';
  import {
    initializeLayout,
    setRestoreStatus,
  } from '$store/renderer/slices/panel-layout/panel-layout-slice';
  import {
    selectPanelIds,
    selectPanelLayoutWorkspace,
  } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
  import type {
    PanelLayoutNode,
    PanelState,
  } from '$store/renderer/slices/panel-layout/panel-layout-types';

  let {
    workspaceKey,
    variant,
    existingIdentity,
  }: {
    workspaceKey: string;
    variant: 'tool-file' | 'tool-note' | 'details-file' | 'details-note';
    existingIdentity?: 'file' | 'note';
  } = $props();

  const initialWorkspaceKey = $state.snapshot(workspaceKey);
  const initialExistingIdentity = $state.snapshot(existingIdentity);
  const workspaceId = WorkspaceId(`chat-tool-navigation-${initialWorkspaceKey}`);
  const sourcePanelId = `source-${initialWorkspaceKey}`;
  const rightPanelId = `right-${initialWorkspaceKey}`;
  const existingPanelId = `existing-${initialWorkspaceKey}`;
  const sourceTabId = `agent-${initialWorkspaceKey}`;
  const rightTabId = `existing-${initialWorkspaceKey}`;
  const identityTabId = `identity-${initialWorkspaceKey}`;
  const disposeStore = startRootStoreLifecycle(
    appStore,
    {
      startSagas: (store) => [
        store.runSaga(panelLayoutSaga),
        store.runSaga(workspaceNavigationTabSaga),
      ],
    },
    storeLifecycleData,
  );

  const panels: Record<string, PanelState> = {
    [sourcePanelId]: {
      id: sourcePanelId,
      tabs: [
        {
          id: sourceTabId,
          type: 'agent',
          title: 'Source chat',
          agentId: 'agent-1',
          workspaceId,
          closable: true,
        },
      ],
      activeTabId: sourceTabId,
    },
    [rightPanelId]: {
      id: rightPanelId,
      tabs: [
        {
          id: rightTabId,
          type: 'file',
          title: 'Existing file',
          filePath: 'src/existing.ts',
          workspaceId,
          closable: true,
        },
      ],
      activeTabId: rightTabId,
    },
  };
  if (initialExistingIdentity) {
    panels[existingPanelId] = {
      id: existingPanelId,
      tabs: [
        {
          id: `placeholder-${initialWorkspaceKey}`,
          type: 'overview',
          title: 'Placeholder',
          workspaceId,
          closable: true,
        },
        {
          id: identityTabId,
          type: initialExistingIdentity,
          title: 'Existing identity',
          workspaceId,
          closable: true,
          ...(initialExistingIdentity === 'file'
            ? { filePath: 'src/tool.ts' }
            : { noteId: 'note-1' }),
        },
      ],
      activeTabId: `placeholder-${initialWorkspaceKey}`,
    };
  }
  const root: PanelLayoutNode = {
    type: 'split',
    direction: 'horizontal',
    sizes: initialExistingIdentity ? [34, 33, 33] : [50, 50],
    children: [
      { type: 'panel', panelId: sourcePanelId },
      ...(initialExistingIdentity ? [{ type: 'panel' as const, panelId: existingPanelId }] : []),
      { type: 'panel', panelId: rightPanelId },
    ],
  };
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root,
      panels,
      focusedPanelId: sourcePanelId,
      canvasWidth: 1000,
    }),
  );
  appStore.dispatch(setRestoreStatus(workspaceId, 'restored'));

  const layout$ = selectPanelLayoutWorkspace(workspaceId);
  const panelIds$ = selectPanelIds(workspaceId);
  const layout = $derived($layout$);
  const panelIds = $derived($panelIds$);
  const sourcePanel = $derived(layout.panels[sourcePanelId]);
  const existingPanel = $derived(layout.panels[existingPanelId]);
  const rightPanel = $derived(layout.panels[panelIds.at(-1) ?? '']);
  const focusedPanel = $derived(
    layout.focusedPanelId ? layout.panels[layout.focusedPanelId] : undefined,
  );
  const sourceTab = $derived(sourcePanel?.tabs.find((tab) => tab.id === sourcePanel.activeTabId));
  const rightTab = $derived(rightPanel?.tabs.find((tab) => tab.id === rightPanel.activeTabId));
  const existingTab = $derived(
    existingPanel?.tabs.find((tab) => tab.id === existingPanel.activeTabId),
  );
  const focusedTab = $derived(
    focusedPanel?.tabs.find((tab) => tab.id === focusedPanel.activeTabId),
  );
  const identityCount = $derived(
    Object.values(layout.panels)
      .flatMap((panel) => panel.tabs)
      .filter((tab) =>
        existingIdentity === 'file'
          ? tab.type === 'file' && tab.filePath === 'src/tool.ts'
          : tab.type === 'note' && tab.noteId === 'note-1',
      ).length,
  );
  let restoreInvoke: (() => void) | undefined;
  let ready = $state(false);

  onMount(() => {
    // eslint-disable-next-line intent/no-component-async-data-fetch -- test-only IPC seam; no domain request
    restoreInvoke = installChatToolNavigationIpcMock();
    ready = true;
  });

  onDestroy(() => {
    restoreInvoke?.();
    disposeStore();
  });
</script>

<div data-chat-tool-navigation-ready={ready}>
  <div data-panel-id={sourcePanelId}>
    {#if variant === 'tool-file'}
      <ToolCall
        toolUse={{
          type: 'tool_use',
          id: 'file-tool',
          name: 'view',
          input: { path: 'src/tool.ts' },
        }}
        result="file contents"
        {workspaceId}
      />
    {:else if variant === 'tool-note'}
      <ToolCall
        toolUse={{
          type: 'tool_use',
          id: 'note-tool',
          name: 'read_note_workspace-mcp',
          input: { noteId: 'note-1' },
        }}
        result={{ noteId: 'note-1', title: 'Plan', content: 'Note content' }}
        {workspaceId}
      />
    {:else if variant === 'details-file'}
      <div data-details-file>
        <ToolDetails
          input={{ path: 'src/details.ts' }}
          result="details"
          parsedResult={{
            type: 'file-view',
            filePath: 'src/details.ts',
            fileName: 'details.ts',
            content: 'details',
          }}
          {workspaceId}
        />
      </div>
    {:else}
      <div data-details-note>
        <ToolDetails
          input={{}}
          result="notes"
          parsedResult={{
            type: 'note-list',
            notes: [{ id: 'details-note', title: 'Details note' }],
          }}
          {workspaceId}
        />
      </div>
    {/if}
  </div>
  <output
    data-navigation-state
    data-panel-count={panelIds.length}
    data-panel-order={panelIds.join(',')}
    data-source-active-type={sourceTab?.type ?? ''}
    data-right-active-type={rightTab?.type ?? ''}
    data-right-active-path={rightTab?.filePath ?? ''}
    data-right-active-note={rightTab?.noteId ?? ''}
    data-existing-panel-id={existingPanelId}
    data-existing-active-type={existingTab?.type ?? ''}
    data-identity-count={identityCount}
    data-focused-panel-id={layout.focusedPanelId ?? ''}
    data-focused-active-type={focusedTab?.type ?? ''}
    data-focused-active-path={focusedTab?.filePath ?? ''}
    data-focused-active-note={focusedTab?.noteId ?? ''}
  ></output>
</div>
