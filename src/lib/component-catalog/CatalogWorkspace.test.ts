/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogFoundations from './CatalogFoundations.svelte';
import CatalogGallery from './CatalogGallery.svelte';
import CatalogShell from './CatalogShell.svelte';
import { themePresets } from '$lib/utils/theme-presets';
import { parseVSCodeTheme } from '$lib/utils/vscode-theme-parser';

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  window.location.hash = '';
  vi.restoreAllMocks();
});

describe('catalog workspace', () => {
  it('uses canonical choices and persists color theme, mode, and motion', async () => {
    vi.mocked(localStorage.setItem).mockClear();
    const first = render(CatalogShell);
    expect(first.container.querySelector('header [data-catalog-control="theme"]')).not.toBeNull();
    const colorThemeTrigger = screen.getByRole('button', { name: 'Color theme' });
    await fireEvent.keyDown(colorThemeTrigger, { key: 'Enter' });
    await fireEvent.keyDown(colorThemeTrigger, { key: 'ArrowDown' });
    await fireEvent.keyDown(colorThemeTrigger, { key: 'Enter' });
    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-color-theme="dracula"]')).not.toBeNull();
      expect(document.documentElement.style.getPropertyValue('--background')).toBe(
        parseVSCodeTheme(themePresets[0].light).cssVariables['--background'],
      );
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-theme="light"]')).not.toBeNull();
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(screen.getByText('Light theme selected')).not.toBeNull();
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'System' }));
    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-theme="system"]')).not.toBeNull();
      expect(screen.getByText(/System theme selected, currently (light|dark)/)).not.toBeNull();
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await fireEvent.click(screen.getByRole('switch', { name: 'Reduce motion' }));

    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-theme="dark"]')).not.toBeNull();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('catalog-reduced-motion')).toBe(true);
      expect(localStorage.setItem).toHaveBeenLastCalledWith(
        'component-catalog-preferences',
        JSON.stringify({
          theme: 'dark',
          colorTheme: 'dracula',
          reducedMotion: true,
        }),
      );
    });
    first.unmount();

    vi.mocked(localStorage.getItem).mockReturnValue(
      JSON.stringify({
        theme: 'dark',
        colorTheme: 'dracula',
        reducedMotion: true,
      }),
    );
    const second = render(CatalogShell);
    await waitFor(() => {
      expect(second.container.querySelector('[data-catalog-theme="dark"]')).not.toBeNull();
      expect(second.container.querySelector('[data-catalog-color-theme="dracula"]')).not.toBeNull();
      expect(
        screen.getByRole('switch', { name: 'Reduce motion' }).getAttribute('aria-checked'),
      ).toBe('true');
    });
  });

  it('renders resolved foundations from CSS variables without physical values', async () => {
    document.documentElement.style.setProperty('--background', '120 10% 96%');
    render(CatalogFoundations);

    expect(screen.getByRole('heading', { name: 'Foundations' })).toBeTruthy();
    expect(screen.getByText('--background')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('120 10% 96%')).toBeTruthy());
    expect(screen.getByTestId('foundation-typography')).toBeTruthy();
    expect(screen.getByTestId('typography-specimens')).toBeTruthy();
    expect(
      ['display', 'title', 'body', 'caption', 'code'].map(
        (style) => document.querySelector(`[data-typography-style="${style}"]`) !== null,
      ),
    ).toEqual([true, true, true, true, true]);
    expect(screen.getByText('Messages, controls, and suggestions')).toBeTruthy();
    expect(screen.getByTestId('foundation-spacing')).toBeTruthy();
    expect(screen.getByText('--space-7')).toBeTruthy();
    expect(screen.getByTestId('foundation-measures')).toBeTruthy();
    expect(screen.getByText('--content-measure-wide')).toBeTruthy();
    expect(screen.getByTestId('foundation-controls')).toBeTruthy();
    expect(screen.getByText('--control-height-large')).toBeTruthy();
    expect(screen.getByText('--radius-large')).toBeTruthy();
    expect(screen.getByTestId('foundation-surface')).toBeTruthy();
    expect(screen.getByText('--surface-hatch')).toBeTruthy();
    expect(screen.getByTestId('foundation-elevation')).toBeTruthy();
  });

  it('filters the gallery and preserves hash navigation active state', async () => {
    render(CatalogGallery);
    const buttonLink = screen.getByRole('link', { name: 'Button', exact: true });
    expect(buttonLink.getAttribute('href')).toBe('#component-button');
    await fireEvent.click(buttonLink);
    expect(buttonLink.getAttribute('aria-current')).toBe('location');

    await fireEvent.input(screen.getByRole('searchbox', { name: 'Search components' }), {
      target: { value: 'dialog' },
    });
    expect(screen.getByRole('heading', { name: 'Dialog' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Button' })).toBeNull();
  });
});
