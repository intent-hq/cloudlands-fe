import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BrowserViewportMenu from './BrowserViewportMenu.svelte';

afterEach(cleanup);

describe('BrowserViewportMenu', () => {
  it('dispatches the selected preset viewport', async () => {
    const onViewportChange = vi.fn();
    render(BrowserViewportMenu, {
      props: { viewport: { mode: 'fit' }, onViewportChange },
    });

    await fireEvent.click(screen.getByTestId('browser-viewport-trigger'));
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: /iPhone SE/ }));

    expect(onViewportChange).toHaveBeenCalledWith({
      mode: 'preset',
      presetId: 'iphone-se',
      width: 375,
      height: 667,
    });
  });

  it('validates and applies a custom viewport', async () => {
    const onViewportChange = vi.fn();
    render(BrowserViewportMenu, {
      props: { viewport: { mode: 'fit' }, onViewportChange },
    });

    await fireEvent.click(screen.getByTestId('browser-viewport-trigger'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Custom…' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
    const width = screen.getByRole('spinbutton', { name: 'Width' });
    const height = screen.getByRole('spinbutton', { name: 'Height' });
    await fireEvent.input(width, { target: { value: '319' } });
    expect(screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
    expect(onViewportChange).not.toHaveBeenCalled();
    await fireEvent.input(width, { target: { value: '412' } });
    await fireEvent.input(height, { target: { value: '915' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onViewportChange).toHaveBeenCalledWith({ mode: 'custom', width: 412, height: 915 });
  });

  it('rejects blank, fractional and over-limit custom dimensions without changing selection', async () => {
    const onViewportChange = vi.fn();
    render(BrowserViewportMenu, {
      props: { viewport: { mode: 'custom', width: 1024, height: 768 }, onViewportChange },
    });
    await fireEvent.click(screen.getByTestId('browser-viewport-trigger'));
    const custom = await screen.findByRole('menuitemradio', { name: /Custom/ });
    expect(custom.getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(custom);
    const width = screen.getByRole('spinbutton', { name: 'Width' });
    const height = screen.getByRole('spinbutton', { name: 'Height' });
    for (const value of ['', '3841', '500.5']) {
      await fireEvent.input(width, { target: { value } });
      expect(screen.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true);
      expect(width.getAttribute('aria-invalid')).toBe('true');
      expect(height.getAttribute('aria-invalid')).toBe('false');
    }
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onViewportChange).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByTestId('browser-viewport-trigger'));
    await fireEvent.click(await screen.findByRole('menuitemradio', { name: /Custom/ }));
    expect((screen.getByRole('spinbutton', { name: 'Width' }) as HTMLInputElement).value).toBe(
      '1024',
    );
  });

  it('rotates a fixed viewport', async () => {
    const onViewportChange = vi.fn();
    render(BrowserViewportMenu, {
      props: {
        viewport: { mode: 'custom', width: 1024, height: 768 },
        onViewportChange,
      },
    });

    await fireEvent.click(screen.getByTestId('browser-viewport-trigger'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Rotate' }));

    expect(onViewportChange).toHaveBeenCalledWith({ mode: 'custom', width: 768, height: 1024 });
  });
});
