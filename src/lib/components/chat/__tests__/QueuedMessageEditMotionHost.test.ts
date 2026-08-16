/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../ui/button/button.svelte', async () => ({
  default: (await import('./mocks/Button.svelte')).default,
}));

import QueuedMessageEditMotionHost from './QueuedMessageEditMotionHost.svelte';

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

afterEach(() => vi.unstubAllGlobals());

describe('QueuedMessageEditMotionHost', () => {
  it('keeps the editing textarea focused through refresh and reorder controls', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const view = render(QueuedMessageEditMotionHost);
    await fireEvent.click(screen.getAllByTestId('queued-message-content')[0]);
    const textarea = await waitFor(() => view.container.querySelector('textarea'));
    await waitFor(() => expect(document.activeElement).toBe(textarea));

    for (const name of ['Refresh', 'Reorder']) {
      const control = screen.getByRole('button', { name });
      const pointerDown = new MouseEvent('pointerdown', { bubbles: true, cancelable: true });
      expect(control.dispatchEvent(pointerDown)).toBe(false);
      expect(pointerDown.defaultPrevented).toBe(true);
      await fireEvent.click(control);
      await waitFor(() => expect(document.activeElement).toBe(textarea));
      expect(view.container.querySelector('textarea')).toBe(textarea);
    }
  });
});
