import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (file: string) => readFileSync(resolve(__dirname, `../${file}`), 'utf8');

describe('panel resize rendering', () => {
  it('updates panel flex styles imperatively without reactive resize state', () => {
    const container = source('PanelContainer.svelte');

    expect(container).toContain('panelElement.style.flex = getPanelChildFlex');
    expect(container).not.toContain('localSizes = $state');
  });

  it('coalesces pointer deltas to one resize write per animation frame', () => {
    const handle = source('PanelSplitHandle.svelte');

    expect(handle).toContain('requestAnimationFrame(flushPendingResize)');
    expect(handle).toContain('pendingResizeDelta += delta');
  });

  it('provides a persisted outer right-edge handle for regular panel layouts', () => {
    const layout = source('PanelLayout.svelte');
    const canvas = source('PanelCanvasFrame.svelte');
    const container = source('PanelContainer.svelte');

    // Canvas width is persisted via Redux `canvasWidth` rather than a separate
    // localStorage key so middle-handle drags that grow the canvas and outer
    // right-edge drags share one source of truth.
    expect(canvas).toContain('storageKey={null}');
    expect(canvas).toContain('side="left"');
    expect(layout).toContain('canvasWidth={$panelCanvasWidth$}');
    expect(layout).toContain('scrollContainer={panelWorkspaceInset}');
    expect(layout).toContain('onResizeEnd={handlePanelCanvasResizeEnd}');
    expect(layout).toContain('resizePanelLayoutRightEdge(effectiveLayoutId');
    expect(container).toContain('rootPanelReferenceSize !== null');
  });

  it('keeps default split children shrinkable until the canvas is explicitly resized', () => {
    const container = source('PanelContainer.svelte');
    const panel = source('Panel.svelte');

    expect(container).toContain('Default split');
    expect(container).not.toContain('min-width: 30em');
    expect(container).toContain('min-width: 30rem');
    expect(container).toContain('overflow: hidden');
    expect(panel).not.toContain('min-width: 30em');
  });

  it('starts regular panel columns at a compact responsive width', () => {
    const layout = source('PanelLayout.svelte');
    const canvas = source('PanelCanvasFrame.svelte');

    expect(layout).toContain('panelColumnCount={$panelColumnCount$}');
    expect(canvas).toContain('getPanelCanvasWidths(viewportWidth, panelColumnCount)');
    expect(canvas).toContain('doSkipResize={contained}');
    expect(canvas).toContain('resizeWithDefaultWidth={true}');
  });

  it('grows the canvas on root horizontal middle-handle drags in both tab and columns mode', () => {
    const container = source('PanelContainer.svelte');

    // `growsCanvasAtRootHorizontal` no longer gates on `contained` — a
    // middle-handle drag at the root horizontal split grows the workspace
    // canvas in tab (single-view) mode as well as columns mode, so sibling
    // panels keep their pixel widths.
    expect(container).toContain('growsCanvasAtRootHorizontal');
    expect(container).not.toMatch(/growsCanvasAtRootHorizontal[^)]*contained &&/);
  });

  it('pins non-growing siblings to their start pixel widths during a canvas-grow drag', () => {
    const container = source('PanelContainer.svelte');

    // During a canvas-grow middle-handle drag the container imperatively
    // pins every sibling to its drag-start pixel width and only grows the
    // target child, bypassing the percentage/reference-size round-trip
    // through Redux. Without this pin, siblings visibly shrink for a frame
    // between the dispatch and the ResizeObserver remeasure.
    expect(container).toContain('canvasResizeStartChildWidths');
    expect(container).toContain('applyLiveCanvasResizeChildWidths');
    expect(container).toMatch(/style\.flex = `0 0 \$\{pinnedWidth\}px`/);
  });
});
