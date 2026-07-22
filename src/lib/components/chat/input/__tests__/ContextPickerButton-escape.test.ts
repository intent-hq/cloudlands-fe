/**
 * ContextPickerButton.svelte Escape handling via the escape-layer stack.
 * Migrated from a <svelte:window onkeydown>; Escape must still dismiss
 * the open popover.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: {} });
});

vi.mock('$lib/services/mentions', () => ({
  getMentionSystem: () => ({ search: vi.fn(async () => []) }),
}));

import ContextPickerButton from '../ContextPickerButton.svelte';

describe('ContextPickerButton Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape dismisses the open popover', async () => {
    render(ContextPickerButton, { props: { panels: [] } });

    const trigger = screen.getByRole('button', { name: 'Add Context' });
    await fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: /select context panels/i })).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: /select context panels/i })).toBeFalsy();
    });
  });

  it('Escape is not consumed while the popover is closed (no layer registered)', async () => {
    render(ContextPickerButton, { props: { panels: [] } });
    expect(screen.queryByRole('dialog', { name: /select context panels/i })).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
