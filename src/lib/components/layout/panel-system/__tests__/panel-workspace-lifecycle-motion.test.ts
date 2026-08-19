import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('panel and workspace lifecycle motion', () => {
  it('animates keyed workspace tabs and content-sized columns', () => {
    const tabs = source('../../WorkspaceTabStrip.svelte');
    const columns = source('../../../workspace/WorkspaceColumnsView.svelte');

    expect(tabs).toContain('data-workspace-tab-motion={workspaceId}');
    expect(tabs).toContain('animate:flip={{ duration: isDragged ? 0 : 180, easing: cubicOut }}');
    expect(tabs).not.toContain('in:fly=');
    expect(tabs).not.toContain('out:fly=');
    expect(columns).toContain('data-workspace-column-motion={workspaceId}');
    expect(columns).toContain(
      'lifecycleMotionReady && columnsReady && anchoredWorkspaceId === null ? 180 : 0',
    );
    expect(columns).toContain("transition:resize={{ axis: 'x', duration: layoutMotionDuration }}");
    expect(columns).not.toContain('isResizingWorkspaceColumn');
    expect(columns).toContain('onPanelCanvasWidthChange={(width) => updatePanelCanvasWidth');
    expect(columns).not.toContain('workspace-panel-columns-width:');
    expect(columns).toContain(':global(body.panel-resizing) [data-workspace-stack]');
    expect(columns).not.toContain('transition:fade');
  });

  it('keeps the first panel mounted and animates keyed split items', () => {
    const layout = source('../PanelLayout.svelte');
    const container = source('../PanelContainer.svelte');

    expect(layout).toContain('data-panel-layout-motion');
    expect(layout).toContain("transition:resize={{ axis: 'x', duration: layoutMotionDuration }}");
    expect(layout).toContain(
      'lifecycleMotionReadyForLayoutId === effectiveLayoutId && !suppressCommittedPanelMoveMotion',
    );
    expect(layout).toContain('commitPanelMoveWithoutReplay(() => {');
    expect(layout).toContain('if (!$isDragging$ && !suppressCommittedPanelMoveMotion)');
    expect(layout).toContain('suppressLayoutMotion={suppressCommittedPanelMoveMotion}');
    expect(layout).toContain('const stableContainerRoot = $derived(');
    expect(layout).toContain("direction: 'horizontal' as const");
    expect(layout).toContain('children: [$root$]');
    expect(layout).toContain('node={stableContainerRoot}');
    expect(container).toContain('{#each getSplitLayoutItems() as item (item.key)}');
    expect(container).toContain(
      'animate:translatePanel={{ duration: layoutMotionDuration, easing: cubicOut }}',
    );
    expect(container).toContain(
      'lifecycleMotionReady && !isResizing && !suppressLayoutMotion && !suppressResizeCommitMotion',
    );
    expect(container).toContain('onResizeStart={handleResizeStart}');
    expect(container).toContain('onUpdateSizes?.(nodePath, committedSizes)');
    expect(container).not.toContain('onUpdateSizes?.(nodePath, newSizes)');
    expect(container).toContain(':global(body.panel-resizing) .panel-split-child');
    expect(container).toContain('key: `gutter:${index}`');
    expect(container).toContain("data-split-gutter={item.type === 'gutter'");
    expect(container).toContain("axis: node.direction === 'horizontal' ? 'x' : 'y'");
    expect(container).toContain(
      'if (suppressLayoutMotion || getDraggedPanelId()) return { duration: 0 }',
    );
    expect(container).toContain('out:resizePanelChild={{');
    expect(container).not.toContain('transition:fade');
  });
});
