import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BrowserDeviceFrame from './BrowserDeviceFrame.svelte';

class FrameResizeObserver {
  static instance?: FrameResizeObserver;
  target?: Element;

  constructor(private readonly callback: ResizeObserverCallback) {
    FrameResizeObserver.instance = this;
  }

  observe(target: Element) {
    this.target = target;
  }

  disconnect() {}

  fire(width: number, height: number) {
    if (!this.target) throw new Error('ResizeObserver target was not observed');
    this.callback(
      [{ target: this.target, contentRect: { width, height } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FrameResizeObserver.instance = undefined;
});

function pointer(type: string, x: number, y: number): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event as PointerEvent;
}

describe('BrowserDeviceFrame', () => {
  it('preserves the viewport aspect ratio when only width is constrained', async () => {
    vi.stubGlobal('ResizeObserver', FrameResizeObserver);
    const { container } = render(BrowserDeviceFrame, {
      props: {
        viewport: { mode: 'custom', width: 800, height: 600 },
        onViewportChange: vi.fn(),
      },
    });

    FrameResizeObserver.instance?.fire(400, 1000);
    await Promise.resolve();

    const frame = container.querySelector('[data-browser-device-frame]') as HTMLElement;
    expect(frame.style.width).toBe('400px');
    expect(frame.style.height).toBe('300px');
    expect(frame.getAttribute('data-width')).toBe('800');
    expect(frame.getAttribute('data-height')).toBe('600');
  });

  it('dispatches the final custom size after a drag resize', async () => {
    const onViewportChange = vi.fn();
    const { container } = render(BrowserDeviceFrame, {
      props: {
        viewport: { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
        onViewportChange,
      },
    });
    const handle = screen.getByRole('button', { name: 'Resize device viewport' });

    await fireEvent(handle, pointer('pointerdown', 100, 100));
    await fireEvent(handle, pointer('pointermove', 137, 125));
    expect(container.querySelector('[data-browser-viewport-readout]')?.textContent).toContain(
      '412 × 692',
    );
    await fireEvent(handle, pointer('pointerup', 137, 125));

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith({ mode: 'custom', width: 412, height: 692 });
  });
});
