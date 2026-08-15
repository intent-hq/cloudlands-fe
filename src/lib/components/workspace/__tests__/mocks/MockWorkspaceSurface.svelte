<script lang="ts">
  let {
    workspaceId,
    active = true,
    manageTab = true,
    columnMode = false,
    draggableTitleRegion = false,
    onCloseWorkspace,
    onSidebarWidthChange,
    onPanelMovePreviewWidthRatioChange,
    onPanelCanvasWidthChange,
    onCyclePanelBoundary,
  }: {
    workspaceId: string;
    active?: boolean;
    manageTab?: boolean;
    columnMode?: boolean;
    draggableTitleRegion?: boolean;
    onCloseWorkspace?: (event: MouseEvent) => void;
    onSidebarWidthChange?: (width: number) => void;
    onPanelMovePreviewWidthRatioChange?: (ratio: number) => void;
    onPanelCanvasWidthChange?: (width: number) => void;
    onCyclePanelBoundary?: (
      direction: 'next' | 'prev',
    ) => { workspaceId: string; layoutId: string } | null;
  } = $props();
</script>

<div
  data-testid="mock-workspace-surface"
  data-workspace-id={workspaceId}
  data-active={active}
  data-manage-tab={manageTab}
  data-column-mode={columnMode}
>
  <div data-workspace-title-region draggable={draggableTitleRegion}></div>
  <div data-mock-panel-header draggable="true"></div>
  <input data-mock-chat-input={workspaceId} onpointerdown={(event) => event.stopPropagation()} />
  <div data-panel-id={`panel-${workspaceId}`}></div>
  <button
    type="button"
    aria-label={`Cycle next panel from ${workspaceId}`}
    onclick={() => onCyclePanelBoundary?.('next')}
  ></button>
  <button
    type="button"
    aria-label="Report wider panel canvas"
    data-mock-panel-resize-preview={workspaceId}
    onclick={() => onPanelCanvasWidthChange?.(1080)}
  ></button>
  <button
    type="button"
    aria-label="Report restored panel canvas"
    data-mock-panel-resize-preview-clear={workspaceId}
    onclick={() => onPanelCanvasWidthChange?.(960)}
  ></button>
  <button
    type="button"
    data-mock-sidebar-width={workspaceId}
    onclick={() => onSidebarWidthChange?.(420)}
  >
    report sidebar width
  </button>
  <button
    type="button"
    aria-label="Preview one panel column"
    data-mock-panel-preview={workspaceId}
    onclick={() => onPanelMovePreviewWidthRatioChange?.(0.5)}
  ></button>
  <button
    type="button"
    aria-label="Clear panel column preview"
    data-mock-panel-preview-clear={workspaceId}
    onclick={() => onPanelMovePreviewWidthRatioChange?.(1)}
  ></button>
</div>
{#if onCloseWorkspace}
  <button
    type="button"
    aria-label={`Close workspace ${workspaceId}`}
    data-workspace-close
    onpointerdown={(event) => event.stopPropagation()}
    onclick={onCloseWorkspace}
  ></button>
{/if}
