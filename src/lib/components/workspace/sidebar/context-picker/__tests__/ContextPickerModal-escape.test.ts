/**
 * ContextPickerModal.svelte Escape handling via the escape-layer stack.
 * Migrated from a `svelte:window` Escape listener.
 */
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/svelte';

// Stub the heavy provider pickers — the escape layer lives on the modal shell.
vi.mock('../LinearPicker.svelte', async () => ({
  default: (
    await import(
      '../../../initializer/__tests__/mocks/MockComponent.svelte'
    )
  ).default,
}));
vi.mock('../SentryPicker.svelte', async () => ({
  default: (
    await import(
      '../../../initializer/__tests__/mocks/MockComponent.svelte'
    )
  ).default,
}));
vi.mock('../BrowserUrlPicker.svelte', async () => ({
  default: (
    await import(
      '../../../initializer/__tests__/mocks/MockComponent.svelte'
    )
  ).default,
}));

import ContextPickerModal from '../ContextPickerModal.svelte';

const baseProps = {
  provider: 'github' as const,
  workspaceId: 'ws-1',
  onSelect: vi.fn(),
};

describe('ContextPickerModal Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes the open modal', async () => {
    const onClose = vi.fn();
    render(ContextPickerModal, { props: { ...baseProps, isOpen: true, onClose } });
    await waitFor(() => {
      expect(screen.getByText('GitHub Issues')).toBeTruthy();
    });

    await fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape is not consumed while the modal is closed (no layer registered)', async () => {
    const onClose = vi.fn();
    render(ContextPickerModal, { props: { ...baseProps, isOpen: false, onClose } });
    expect(screen.queryByText('GitHub Issues')).toBeFalsy();

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});
