/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import { migratePanelCanvasWidth } from '$store/renderer/slices/panel-layout/panel-layout-width-provenance';
import PanelCanvasGeometryHarness from './mocks/PanelCanvasGeometryHarness.svelte';

const STORE_CONTEXT = 'redux-store-context';
let storeContext: ReduxStoreContext | undefined;

const ordinaryProps = {
  sizing: 'viewport' as const,
  viewportWidth: 1600,
  panelColumnWidths: [500],
  canvasWidth: null,
  onResizeEnd: vi.fn(),
};

function canvas(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

function geometryWidth(element: HTMLElement): number {
  return element.getBoundingClientRect().width;
}

beforeEach(() => {
  storeContext = initAppStore(appStore);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const width = Number.parseFloat(this.style.width) || 0;
    return {
      width,
      height: 800,
      top: 0,
      right: width,
      bottom: 800,
      left: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.restoreAllMocks();
});

describe('mounted panel canvas geometry', () => {
  it('fills one-panel viewports and preserves explicit overflow preferences', async () => {
    const result = render(PanelCanvasGeometryHarness, {
      props: ordinaryProps,
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    expect(geometryWidth(canvas(result.container))).toBe(1200);

    await result.rerender({ ...ordinaryProps, panelColumnWidths: [900] });
    expect(geometryWidth(canvas(result.container))).toBe(1200);

    await result.rerender({
      ...ordinaryProps,
      canvasWidth: migratePanelCanvasWidth(1600, undefined).canvasWidth,
    });
    expect(geometryWidth(canvas(result.container))).toBe(1200);

    await result.rerender({
      ...ordinaryProps,
      viewportWidth: 480,
      canvasWidth: migratePanelCanvasWidth(600, 'explicit').canvasWidth,
    });
    expect(geometryWidth(canvas(result.container))).toBe(600);
  });

  it('rehydrates an explicit width when the viewport is wider and then resizes', async () => {
    const result = render(PanelCanvasGeometryHarness, {
      props: { ...ordinaryProps, viewportWidth: 1000, canvasWidth: 600 },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    expect(geometryWidth(canvas(result.container))).toBe(600);

    await result.rerender({ ...ordinaryProps, viewportWidth: 1200, canvasWidth: 600 });
    expect(geometryWidth(canvas(result.container))).toBe(600);
  });

  it('ignores long content, sidebar viewport, zoom, and tab-stack mode changes', async () => {
    const result = render(PanelCanvasGeometryHarness, {
      props: { ...ordinaryProps, longContent: true },
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    expect(result.getByTestId('long-content').className).toContain('w-[4000px]');
    expect(geometryWidth(canvas(result.container))).toBe(1200);

    await result.rerender({ ...ordinaryProps, longContent: true, viewportWidth: 1240 });
    expect(geometryWidth(canvas(result.container))).toBe(1200);

    await result.rerender({ ...ordinaryProps, longContent: true, viewportWidth: 800 });
    expect(geometryWidth(canvas(result.container))).toBe(800);

    await result.rerender({ ...ordinaryProps, longContent: true, sizing: 'content' });
    expect(geometryWidth(canvas(result.container))).toBe(500);

    await result.rerender({
      ...ordinaryProps,
      longContent: true,
      sizing: 'viewport',
      canvasWidth: 720,
    });
    expect(geometryWidth(canvas(result.container))).toBe(720);
    await result.rerender({
      ...ordinaryProps,
      longContent: true,
      sizing: 'content',
      canvasWidth: 720,
    });
    expect(geometryWidth(canvas(result.container))).toBe(720);
  });

  it('resizes to 280px, rehydrates exactly, and resets to the intrinsic width', async () => {
    const onResizeEnd = vi.fn();
    const explicitProps = {
      ...ordinaryProps,
      sizing: 'content' as const,
      canvasWidth: 600,
      onResizeEnd,
    };
    const result = render(PanelCanvasGeometryHarness, {
      props: explicitProps,
      context: new Map([[STORE_CONTEXT, storeContext]]),
    });
    const handle = result.container.querySelector<HTMLButtonElement>(
      '.panel-canvas-resize-handle',
    )!;

    fireEvent.mouseDown(handle, { clientX: 600 });
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseUp(document, { clientX: 200 });
    await tick();
    expect(geometryWidth(canvas(result.container))).toBe(280);
    expect(onResizeEnd).toHaveBeenLastCalledWith(600, 280);

    await result.rerender({ ...explicitProps, canvasWidth: 280 });
    expect(geometryWidth(canvas(result.container))).toBe(280);

    await fireEvent.dblClick(handle);
    expect(onResizeEnd).toHaveBeenLastCalledWith(280, 500);
    await result.rerender(ordinaryProps);
    expect(geometryWidth(canvas(result.container))).toBe(1200);
  });
});
