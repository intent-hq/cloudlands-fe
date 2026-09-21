// @verify-changed-triggers: ../Panel.svelte, ../PanelCanvasFrame.svelte, ../PanelContainer.svelte,
//   ../PanelLayout.svelte

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(__dirname, `../${file}`), 'utf8');

describe('panel resize rendering', () => {
  it('preserves canvas width persistence and resize plumbing for regular panel layouts', () => {
    const layout = source('PanelLayout.svelte');
    const canvas = source('PanelCanvasFrame.svelte');
    const container = source('PanelContainer.svelte');

    // Removing the outer interaction must not change stored canvas sizing.
    expect(canvas).toContain('storageKey={null}');
    expect(canvas).toContain('side="left"');
    expect(layout).toContain('panelOuterResizeCommittedWidth ?? $panelCanvasWidth$');
    expect(layout).toContain('getPanelPreferredWidths(');
    expect(layout).toContain('scrollContainer={panelWorkspaceInset}');
    expect(layout).toContain('onResizeEnd={handlePanelCanvasResizeEnd}');
    expect(layout).toContain('onResizePreview={handlePanelOuterResizePreview}');
    expect(layout).toContain('resizePanelLayoutRightEdge(');
    expect(layout).toContain('effectiveLayoutId,');
    expect(container).toContain('rootPanelReferenceSize !== null');
  });

  it('keeps split children shrinkable and delegates overflow to the canvas', () => {
    const container = source('PanelContainer.svelte');
    const panel = source('Panel.svelte');

    expect(container).not.toContain('min-width: 30em');
    expect(container).toContain('min-width: 0');
    expect(container).toContain('overflow: hidden');
    expect(panel).not.toContain('min-width: 30em');
  });

  it('passes canonical preferred widths through the responsive allocator', () => {
    const layout = source('PanelLayout.svelte');
    const canvas = source('PanelCanvasFrame.svelte');

    expect(layout).toContain('panelColumnWidths={panelColumnPreferredWidths}');
    expect(canvas).toContain(
      'getPanelCanvasWidths(\n      viewportWidth,\n      panelColumnWidths,',
    );
    expect(layout).toContain('sizing={canvasSizing}');
    expect(canvas).not.toContain('doSkipResize');
    expect(canvas).toContain('syncWithDefaultWidth={true}');
  });

  it('uses proportional fixed-canvas resizing in both tab and columns mode', () => {
    const container = source('PanelContainer.svelte');

    expect(container).toContain('resizesRootDivider');
    expect(container).toContain('resizePanelWidthsAtDivider(');
    expect(container).not.toMatch(/resizesRootDivider[^)]*contained &&/);
  });

  it('pins every proportional preview width during a root-divider drag', () => {
    const container = source('PanelContainer.svelte');

    expect(container).toContain('rootResizeStartChildWidths');
    expect(container).toContain('rootResizeNextChildWidths');
    expect(container).toContain('applyLiveRootResizeChildWidths');
    expect(container).toContain('return `0 0 ${pinnedWidth}px`;');
    expect(container).toContain('onResizeStart={handleResizeStart}');
  });

  it('bypasses adjacent redistribution for every root horizontal handle', () => {
    const container = source('PanelContainer.svelte');
    const rootBranch = container.indexOf(
      'if (resizesRootDivider && rootResizeStartChildWidths !== null)',
    );
    const adjacentFallback = container.indexOf('const newSizes = resizeAdjacentPanels');

    expect(rootBranch).toBeGreaterThan(0);
    expect(rootBranch).toBeLessThan(adjacentFallback);
    expect(container.slice(rootBranch, adjacentFallback)).toContain('return;');
  });

  it('applies outer canvas resize preview only to the final root panel', () => {
    const container = source('PanelContainer.svelte');

    expect(container).toContain("node.direction === 'horizontal'");
    expect(container).toContain('rootCanvasResizeDelta !== 0');
    expect(container).toContain('index === node.children.length - 1');
    expect(container).toContain('previousWidth + rootCanvasResizeDelta');
  });

  it('suppresses layout motion through the Redux resize commit frame', () => {
    const container = source('PanelContainer.svelte');
    const layout = source('PanelLayout.svelte');

    expect(container).toContain('suppressMotionThroughResizeCommit()');
    expect(container).toContain('!suppressResizeCommitMotion');
    expect(layout).toContain('layoutManager.resizeRootDivider(');
    expect(container).not.toContain('panelElement.style.flex = getPanelChildFlex(child, index);');
  });
});
