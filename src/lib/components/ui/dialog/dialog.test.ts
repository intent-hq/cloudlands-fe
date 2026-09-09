import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import DialogHarness from './DialogHarness.svelte';
import { dialogMetadata } from './dialog.meta';
import { legacyOverlayDeprecations } from './legacy-overlays.meta';
import { overlayMotion } from './overlay-motion.svelte';

afterEach(cleanup);

describe('Dialog', () => {
  it('publishes validated fixtures and measurable legacy replacement gates', () => {
    expect(dialogMetadata.fixtures[0]?.states).toContain('open');
    expect(dialogMetadata.fixtures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'dialog-open-state',
          states: expect.arrayContaining(['open-on-mount', 'focus-return']),
        }),
      ]),
    );
    expect(legacyOverlayDeprecations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ replacement: '$lib/components/ui/sheet' }),
      ]),
    );
    expect(legacyOverlayDeprecations.every((record) => record.removalGate.length > 0)).toBe(true);
    expect(legacyOverlayDeprecations.every((record) => record.callers.length === 0)).toBe(true);
  });

  it('shares token-driven entrance and tween-exit recipes with Sheet', () => {
    expect(overlayMotion.backdrop.enter.tier).toBe('moderate');
    expect(overlayMotion.dialog.enter).toMatchObject({ tier: 'slow', scale: 0.97, y: 8 });
    expect(overlayMotion.dialog.exit).toEqual(overlayMotion.dialog.enter);
    expect(overlayMotion.sheet('left').exit).toEqual(overlayMotion.sheet('left').enter);
    expect(overlayMotion.sheet('right').enter.x).toBe('100%');
    expect(overlayMotion.sheet('top').enter.y).toBe('-100%');
    expect(overlayMotion.dialog.enter).not.toHaveProperty('duration');
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
    expect(dialog.isConnected).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('traps focus, keeps nested interactions open, and restores focus after Escape', async () => {
    render(DialogHarness);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    trigger.focus();
    await fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(screen.getByRole('textbox', { name: 'Dialog field' }).className).toContain(
      'var(--ring)',
    );
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

  it('keeps long content inside the accessible dialog', async () => {
    render(DialogHarness, { props: { longContent: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(screen.getByRole('heading', { name: 'Canonical dialog' }))).toBe(true);
    expect(dialog.contains(screen.getByText('Dialog behavior fixture'))).toBe(true);
    expect(screen.getByTestId('dialog-long-content')).toBeTruthy();
  });

  it('keeps a destructive confirmation action inside the focus trap until explicit dismissal', async () => {
    render(DialogHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    const action = screen.getByRole('button', { name: 'Delete item' });
    expect(action.dataset.slot).toBe('button');
    await fireEvent.click(action);
    expect(screen.getByLabelText('Dialog destructive count').textContent).toBe('1');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
