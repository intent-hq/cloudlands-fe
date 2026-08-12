import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DialogHarness from './DialogHarness.svelte';
import { dialogMetadata } from './dialog.meta';
import { legacyOverlayDeprecations } from './legacy-overlays.meta';

afterEach(cleanup);

describe('Dialog', () => {
  it('publishes validated fixtures and measurable legacy replacement gates', () => {
    expect(dialogMetadata.fixtures[0]?.states).toContain('open');
    expect(legacyOverlayDeprecations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replacement: '$lib/components/ui/dialog' }),
        expect.objectContaining({ replacement: '$lib/components/ui/sheet' }),
      ]),
    );
    expect(legacyOverlayDeprecations.every((record) => record.removalGate.length > 0)).toBe(true);
  });

  it('renders open/closed state with labelled and described semantics', async () => {
    render(DialogHarness);
    expect(screen.queryByRole('dialog')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog', { name: 'Canonical dialog' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Dialog behavior fixture',
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('traps focus, keeps nested interactions open, and restores focus after Escape', async () => {
    render(DialogHarness);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    await fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Nested dialog action' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('dismisses from outside interaction and restores focus', async () => {
    render(DialogHarness);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    await fireEvent.click(trigger);

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')!;
    await waitFor(() =>
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('supports a disabled close control and reduced motion', async () => {
    render(DialogHarness, { props: { closeDisabled: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));

    const close = screen.getByRole('button', { name: 'Close dialog' });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(close);
    expect(screen.getByRole('dialog')).toBeTruthy();

    expect(screen.getByRole('dialog').className).toContain('motion-reduce:animate-none');
    expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain(
      'motion-reduce:animate-none',
    );
    await fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('uses the editorial overlay surface and contains long content without viewport overflow', async () => {
    render(DialogHarness, { props: { longContent: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('bg-popover');
    expect(dialog.className).toContain('border-border');
    expect(dialog.className).toContain('rounded-md');
    expect(dialog.className).toContain('p-4');
    expect(dialog.className).toContain('dialog-editorial-content');
    expect(dialog.className).toContain('overflow-y-auto');
    expect(document.querySelector('[data-slot="dialog-title"]')?.className).toContain('type-title');
    expect(document.querySelector('[data-slot="dialog-description"]')?.className).toContain(
      'type-body',
    );
    expect(document.querySelector('[data-slot="dialog-footer"]')?.className).toContain(
      'border-border',
    );
    expect(screen.getByTestId('dialog-long-content')).toBeTruthy();
    expect(dialog.className).not.toMatch(/bg-(?:white|black|gray|slate|zinc|neutral)-?/);
  });

  it('keeps a destructive confirmation action inside the focus trap until explicit dismissal', async () => {
    render(DialogHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
    expect(screen.getByLabelText('Dialog destructive count').textContent).toBe('1');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
