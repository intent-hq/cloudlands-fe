import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BrowserDeviceFrame from './BrowserDeviceFrame.svelte';

afterEach(cleanup);

function pointer(type: string, x: number, y: number): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  return event as PointerEvent;
}

describe('BrowserDeviceFrame', () => {
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
