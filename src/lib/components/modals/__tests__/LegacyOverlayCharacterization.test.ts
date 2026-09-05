import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import LegacyOverlayHarness from './LegacyOverlayHarness.svelte';

vi.mock('$lib/components/ui/Portal.svelte', async () => ({
  default: (await import('./mocks/MockPortal.svelte')).default,
}));

vi.mock('svelte-fa', async () => ({
  default: (await import('../../workspace/sidebar/__tests__/mocks/Fa.svelte')).default,
}));

vi.mock('$lib/components/ui/button/button.svelte', async () => ({
  default: (await import('../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));

vi.mock('$lib/components/ui/button', async () => ({
  Button: (await import('../../terminal/__tests__/mocks/MockButton.svelte')).default,
}));

afterEach(cleanup);

describe('legacy Drawer behavior', () => {
  it('preserves side placement and dismisses from its backdrop', async () => {
    render(LegacyOverlayHarness, { props: { kind: 'drawer', position: 'left' } });
    const launcher = screen.getByTestId('launcher');

    launcher.focus();
    await fireEvent.click(launcher);
    const drawer = screen.getByRole('dialog');
    expect(drawer.className).toContain('left-0');
    expect(screen.getByRole('heading', { name: 'Legacy drawer' })).toBeTruthy();

    const overlay = document.querySelector('[data-slot="sheet-overlay"]')!;
    await waitFor(() => expect(drawer.contains(document.activeElement)).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fireEvent.pointerDown(overlay, {
      button: 0,
      clientX: 10,
      clientY: 10,
      pointerType: 'mouse',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('close-count').textContent).toBe('1');
    expect(document.activeElement).toBe(launcher);
  });

  it('keeps nested interactions open and closes from Escape inside content', async () => {
    render(LegacyOverlayHarness, { props: { kind: 'drawer' } });
    await fireEvent.click(screen.getByTestId('launcher'));

    await fireEvent.click(screen.getByRole('button', { name: 'Nested drawer action' }));
    expect(screen.getByRole('dialog')).toBeTruthy();

    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('close-count').textContent).toBe('1');
  });
});
