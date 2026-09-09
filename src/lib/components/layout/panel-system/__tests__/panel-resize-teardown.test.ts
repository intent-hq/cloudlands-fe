// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PanelCornerHandle from '../PanelCornerHandle.svelte';
import PanelSplitHandle from '../PanelSplitHandle.svelte';

afterEach(() => {
  document.body.classList.remove('panel-resizing');
  vi.restoreAllMocks();
});

function expectOwnedDragListenersRemoved(
  addListener: ReturnType<typeof vi.spyOn>,
  removeListener: ReturnType<typeof vi.spyOn>,
) {
  const dragListeners = addListener.mock.calls.filter(
    ([type]) => type === 'mousemove' || type === 'mouseup',
  );
  expect(dragListeners).toHaveLength(2);
  for (const [type, listener] of dragListeners) {
    expect(removeListener).toHaveBeenCalledWith(type, listener);
  }
}

describe('panel resize handle teardown', () => {
  it('releases split listeners and body state when unmounted mid-drag', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = render(PanelSplitHandle, {
      props: { direction: 'horizontal', onResize, onResizeEnd },
    });

    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 20 });
    view.unmount();

    expect(document.body.classList.contains('panel-resizing')).toBe(false);
    expectOwnedDragListenersRemoved(addListener, removeListener);
    await fireEvent.mouseMove(window, { clientX: 40 });
    await fireEvent.mouseUp(window);
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it('cancels a pending split frame without delivering its stale delta', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    let scheduledResize: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      scheduledResize = callback;
      return 71;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    const view = render(PanelSplitHandle, {
      props: { direction: 'horizontal', onResize, onResizeEnd },
    });

    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 20 });
    await fireEvent.mouseMove(window, { clientX: 40 });
    view.unmount();
    scheduledResize?.(0);

    expect(cancelFrame).toHaveBeenCalledWith(71);
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it('releases corner listeners without callbacks after destruction', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const addListener = vi.spyOn(window, 'addEventListener');
    const removeListener = vi.spyOn(window, 'removeEventListener');
    const view = render(PanelCornerHandle, { props: { onResize, onResizeEnd } });

    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 10, clientY: 15 });
    view.unmount();

    expect(document.body.classList.contains('panel-resizing')).toBe(false);
    expectOwnedDragListenersRemoved(addListener, removeListener);
    await fireEvent.mouseMove(window, { clientX: 16, clientY: 24 });
    await fireEvent.mouseUp(window);
    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  it('remains clean across repeated mounted drag lifecycles', async () => {
    for (const Component of [PanelSplitHandle, PanelCornerHandle]) {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const view = render(Component, {
          props: Component === PanelSplitHandle ? { direction: 'horizontal' } : {},
        });
        await fireEvent.mouseDown(view.getByRole('button'), { clientX: 10, clientY: 10 });
        expect(document.body.classList.contains('panel-resizing')).toBe(true);
        view.unmount();
        expect(document.body.classList.contains('panel-resizing')).toBe(false);
      }
    }
  });

  it('keeps body state until a sibling resize owner finishes', async () => {
    const split = render(PanelSplitHandle, { props: { direction: 'horizontal' } });
    const corner = render(PanelCornerHandle);
    await fireEvent.mouseDown(split.getByRole('button', { name: 'Resize panel' }), { clientX: 10 });
    await fireEvent.mouseDown(corner.getByRole('button', { name: 'Resize panel corner' }), {
      clientX: 10,
      clientY: 10,
    });

    split.unmount();
    expect(document.body.classList.contains('panel-resizing')).toBe(true);
    await fireEvent.mouseUp(window);
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
    corner.unmount();
  });

  it('does not clear body state owned before the handle drag', async () => {
    document.body.classList.add('panel-resizing');
    const view = render(PanelCornerHandle);
    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 10, clientY: 10 });

    view.unmount();

    expect(document.body.classList.contains('panel-resizing')).toBe(true);
  });

  it('preserves normal split mouseup flushing and completion', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 19);
    const view = render(PanelSplitHandle, {
      props: { direction: 'horizontal', onResize, onResizeEnd },
    });
    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 20 });
    await fireEvent.mouseMove(window, { clientX: 49 });

    await fireEvent.mouseUp(window);
    view.unmount();

    expect(cancelFrame).toHaveBeenCalledWith(19);
    expect(onResize).toHaveBeenCalledOnce();
    expect(onResize).toHaveBeenCalledWith(29);
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
  });

  it('preserves normal corner mouseup completion', async () => {
    const onResize = vi.fn();
    const onResizeEnd = vi.fn();
    const view = render(PanelCornerHandle, { props: { onResize, onResizeEnd } });
    await fireEvent.mouseDown(view.getByRole('button'), { clientX: 10, clientY: 15 });
    await fireEvent.mouseMove(window, { clientX: 16, clientY: 24 });

    await fireEvent.mouseUp(window);
    view.unmount();

    expect(onResize).toHaveBeenCalledWith(6, 9);
    expect(onResizeEnd).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('panel-resizing')).toBe(false);
  });
});
