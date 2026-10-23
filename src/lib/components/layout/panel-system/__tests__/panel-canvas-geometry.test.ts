/** @vitest-environment jsdom */
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
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

beforeEach(() => {
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.restoreAllMocks();
});

describe('panel canvas resize interactions', () => {
  it('does not expose an outer resize interaction', async () => {
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
    expect(result.queryByRole('button')).toBeNull();
    fireEvent.mouseDown(canvas(result.container), { clientX: 600 });
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseUp(document, { clientX: 200 });
    await tick();
    expect(onResizeEnd).not.toHaveBeenCalled();

    await result.rerender({ ...explicitProps, canvasWidth: 280 });

    await fireEvent.dblClick(canvas(result.container));
    expect(onResizeEnd).not.toHaveBeenCalled();
  });
});
