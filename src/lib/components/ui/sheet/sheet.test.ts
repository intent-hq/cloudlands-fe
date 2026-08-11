import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import SheetHarness from './SheetHarness.svelte';
import { sheetMetadata } from './sheet.meta';

afterEach(cleanup);

describe('Sheet', () => {
  it('publishes validated state-matrix metadata', () => {
    expect(sheetMetadata.owner).toBe('007-B4');
    expect(sheetMetadata.fixtures[0]?.states).toEqual(
      expect.arrayContaining(['closed', 'open', 'disabled-close']),
    );
  });

  it('provides labelled semantics, nested interaction, focus restoration, and dismissal', async () => {
    render(SheetHarness);
    const trigger = screen.getByRole('button', { name: 'Open sheet' });
    trigger.focus();
    await fireEvent.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Canonical sheet' });
    expect(document.getElementById(sheet.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Sheet behavior fixture',
    );
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    await fireEvent.click(screen.getByRole('button', { name: 'Nested sheet action' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('supports outside dismissal, a disabled close control, and reduced motion', async () => {
    const { unmount } = render(SheetHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
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
    unmount();

    render(SheetHarness, { props: { closeDisabled: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    const close = screen.getByRole('button', { name: 'Close sheet' });
    expect((close as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(close);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('dialog').className).toContain('motion-reduce:animate-none');
    expect(document.querySelector('[data-slot="sheet-overlay"]')?.className).toContain(
      'motion-reduce:animate-none',
    );
    await fireEvent.keyDown(close, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('uses a contained editorial surface with a quiet edge and stable scrolling', async () => {
    render(SheetHarness, { props: { longContent: true } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    const sheet = screen.getByRole('dialog');
    expect(sheet.className).toContain('bg-popover');
    expect(sheet.className).toContain('border-border');
    expect(sheet.className).toContain('overflow-y-auto');
    expect(sheet.className).toContain('sheet-editorial-content');
    expect(sheet.className).toContain('rounded-l-md');
    expect(sheet.getAttribute('data-side')).toBe('right');
    expect(document.querySelector('[data-slot="sheet-title"]')?.className).toContain('type-title');
    expect(document.querySelector('[data-slot="sheet-description"]')?.className).toContain(
      'type-body',
    );
    expect(document.querySelector('[data-slot="sheet-header"]')?.className).toContain('px-4');
    expect(document.querySelector('[data-slot="sheet-footer"]')?.className).toContain('py-3');
    expect(screen.getByTestId('sheet-long-content')).toBeTruthy();
    expect(sheet.className).not.toMatch(/bg-(?:white|black|gray|slate|zinc|neutral)-?/);
  });

  it('keeps a destructive confirmation action open until explicit dismissal', async () => {
    render(SheetHarness);
    await fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Delete item' }));
    expect(screen.getByLabelText('Sheet destructive count').textContent).toBe('1');
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
