/**
 * Modal.svelte Escape handling via the escape-layer stack.
 *
 * Migrated from a legacy capture-phase window keydown listener. Semantics
 * preserved: Escape closes the modal, EXCEPT while an input/textarea is
 * focused — then the modal declines so the input's own handler keeps the key.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import Modal from '../Modal.svelte';

describe('Modal Escape handling (escape-layer stack)', () => {
  afterEach(() => {
    cleanup();
  });

  it('Escape closes the modal when it is the only overlay', async () => {
    const onClose = vi.fn();
    render(Modal, { props: { open: true, title: 'Test Modal', onClose } });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Test Modal' })).toBeTruthy();
    });

    await fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the modal open on Escape while an input is focused', async () => {
    const onClose = vi.fn();
    const children = createRawSnippet(() => ({
      render: () => '<input aria-label="Draft" />',
    }));
    render(Modal, { props: { open: true, title: 'Test Modal', onClose, children } });
    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Test Modal' })).toBeTruthy();
    });

    const input = screen.getByRole('textbox', { name: 'Draft' });
    input.focus();
    await tick();
    await fireEvent.keyDown(input, { key: 'Escape' });

    // The canonical dialog may consume Escape, but the modal must remain open.
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Test Modal' })).toBeTruthy();

    // Escape from a non-input target still closes
    screen.getByRole('button', { name: 'Close modal' }).focus();
    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('opened on top of another canonical dialog: Escape closes modals in LIFO order', async () => {
    const onLowerClose = vi.fn();
    const onTopClose = vi.fn();
    render(Modal, { props: { open: true, title: 'Lower Modal', onClose: onLowerClose } });
    await tick();
    render(Modal, { props: { open: true, title: 'Top Modal', onClose: onTopClose } });
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(2));

    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onTopClose).toHaveBeenCalledTimes(1));
    expect(onLowerClose).not.toHaveBeenCalled();

    await fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onLowerClose).toHaveBeenCalledTimes(1));
  });
});
