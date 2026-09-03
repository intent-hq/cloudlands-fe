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
    const width = screen.getByRole('spinbutton', { name: 'Width' });
    const height = screen.getByRole('spinbutton', { name: 'Height' });
    await fireEvent.input(width, { target: { value: '412' } });
    await fireEvent.input(height, { target: { value: '915' } });
    await fireEvent.submit(screen.getByTestId('viewport-custom-form'));

    expect(onViewportChange).toHaveBeenCalledWith({ mode: 'custom', width: 412, height: 915 });
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
