/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import axe from 'axe-core';
import { createRawSnippet } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import CatalogIntroduction from './CatalogIntroduction.svelte';
import CatalogShell from './CatalogShell.svelte';
import SandboxLayout from '../../routes/sandbox/+layout.svelte';
import CatalogSystemPage from './CatalogSystemPage.svelte';
import { themePresets } from '$lib/utils/theme-presets';
import { parseVSCodeTheme } from '$lib/utils/vscode-theme-parser';

const { mockPage } = vi.hoisted(() => ({
  mockPage: { params: {}, url: new URL('http://localhost/sandbox') },
}));

vi.mock('$app/state', () => ({ page: mockPage }));

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  mockPage.url = new URL('http://localhost/sandbox');
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
  beforeAll(() => appStore.init());

  it.each([
    { pathname: '/sandbox', name: 'Introduction' },
    { pathname: '/sandbox/recipes', name: 'Recipes' },
  ])(
    'selects the current navigation link from page.url at $pathname',
    async ({ pathname, name }) => {
      mockPage.url = new URL(pathname, 'http://localhost');
      render(SandboxLayout);

      const navigation = within(screen.getByRole('navigation', { name: 'Component catalog' }));
      await waitFor(() =>
        expect(navigation.getAllByRole('link', { current: 'page' })).toEqual([
          navigation.getByRole('link', { name, exact: true }),
        ]),
      );
    },
  );

  it('lets the sandbox layout own the bundled UI font across themes and restore it', async () => {
    const root = document.documentElement;
    root.style.setProperty('--font-ui', 'Existing UI');
    root.style.setProperty('--existing-root-token', 'preserved');

    const first = render(SandboxLayout);
    await waitFor(() =>
      expect(root.style.getPropertyValue('--font-ui')).toContain('Inter Variable'),
    );
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => {
      expect(root.classList.contains('dark')).toBe(true);
      expect(root.style.getPropertyValue('--font-ui')).toContain('Inter Variable');
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    await waitFor(() =>
      expect(root.style.getPropertyValue('--font-ui')).toContain('Inter Variable'),
    );
    first.unmount();
    expect(root.style.getPropertyValue('--font-ui')).toBe('Existing UI');
    expect(root.style.getPropertyValue('--existing-root-token')).toBe('preserved');

    const second = render(SandboxLayout);
    await waitFor(() =>
      expect(root.style.getPropertyValue('--font-ui')).toContain('Inter Variable'),
    );
    second.unmount();
    expect(root.style.getPropertyValue('--font-ui')).toBe('Existing UI');
  });

  it('contains navigation, customization, preview, and documentation inside landmarks', async () => {
    const children = createRawSnippet(() => ({
      render: () => '<p>Catalog documentation</p>',
    }));
    const { container } = render(CatalogShell, { props: { children } });

    const navigation = screen.getByRole('navigation', { name: 'Component catalog' });
    const customization = screen.getByRole('complementary', { name: 'Catalog customization' });
    const main = screen.getByRole('main');
    expect(navigation.contains(screen.getByRole('link', { name: 'Component catalog home' }))).toBe(
      true,
    );
    expect(customization.contains(screen.getByRole('button', { name: 'Customize preview' }))).toBe(
      true,
    );
    expect(main.textContent).toContain('Catalog documentation');

    const result = await axe.run(container, {
      runOnly: { type: 'rule', values: ['region'] },
    });
    expect(result.violations).toEqual([]);
  });

  it('preserves display preferences when customization is collapsed and reopened', async () => {
    render(CatalogShell);
    const disclosure = screen.getByRole('button', { name: 'Customize preview' });
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(disclosure);
    expect(screen.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('uses canonical choices and persists color theme, mode, and motion', async () => {
    vi.mocked(localStorage.setItem).mockClear();
    const first = render(CatalogShell);
    expect(first.container.querySelector('[data-catalog-control="theme"]')).not.toBeNull();
    const colorThemeTrigger = screen.getByRole('combobox', { name: 'Color theme' });
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
    await fireEvent.click(
      within(screen.getByRole('group', { name: 'Theme' })).getByRole('radio', { name: 'System' }),
    );
    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-theme="system"]')).not.toBeNull();
      expect(screen.getByText(/System theme selected, currently (light|dark)/)).not.toBeNull();
    });
    await fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Reduced' }));

    await waitFor(() => {
      expect(first.container.querySelector('[data-catalog-theme="dark"]')).not.toBeNull();
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(document.documentElement.classList.contains('catalog-reduced-motion')).toBe(true);
      expect(localStorage.setItem).toHaveBeenLastCalledWith(
        'component-catalog-preferences',
        JSON.stringify({
          theme: 'dark',
          colorTheme: 'dracula',
          motion: 'reduced',
        }),
      );
    });
    first.unmount();

    vi.mocked(localStorage.getItem).mockReturnValue(
      JSON.stringify({
        theme: 'dark',
        colorTheme: 'dracula',
        motion: 'reduced',
      }),
    );
    const second = render(CatalogShell);
    await waitFor(() => {
      expect(second.container.querySelector('[data-catalog-theme="dark"]')).not.toBeNull();
      expect(second.container.querySelector('[data-catalog-color-theme="dracula"]')).not.toBeNull();
      expect(screen.getByRole('radio', { name: 'Reduced' }).getAttribute('aria-checked')).toBe(
        'true',
      );
    });
  });

  it('presents the landing and system pages as navigable documentation', async () => {
    const landing = render(CatalogIntroduction);
    expect(screen.getByRole('heading', { name: 'Intent design system' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Surfaces/ }).getAttribute('href')).toBe(
      '/sandbox/surfaces',
    );
    landing.unmount();

    const motion = render(CatalogSystemPage, { props: { slug: 'motion' } });
    const replay = screen.getByRole('button', { name: 'Replay motion' });
    const originalDots = Array.from(motion.container.querySelectorAll('.spring-track i'));
    expect(originalDots).toHaveLength(3);
    await fireEvent.click(replay);
    expect(originalDots.every((dot) => !dot.isConnected)).toBe(true);
    const replayedDots = Array.from(motion.container.querySelectorAll('.spring-track i'));
    expect(replayedDots).toHaveLength(3);
    await fireEvent.click(replay);
    expect(replayedDots.every((dot) => !dot.isConnected)).toBe(true);
    motion.unmount();

    render(CatalogSystemPage, { props: { slug: 'surfaces' } });
    expect(screen.getAllByText(/Surface [1-8]/)).toHaveLength(8);
  });
});
