// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UiComponentFixture } from '$lib/components/ui/component-metadata';
import NavigationHelpCatalogPreview from './NavigationHelpCatalogPreview.svelte';

const originalMatchMedia = window.matchMedia;
const originalResizeObserver = globalThis.ResizeObserver;
const fixture: UiComponentFixture = {
  id: 'navigation-help',
  title: 'Navigation help',
  states: ['default'],
};

beforeEach(() => {
  globalThis.ResizeObserver = class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

function stubMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((media: string) => ({
      matches,
      media,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  globalThis.ResizeObserver = originalResizeObserver;
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia });
});

describe('NavigationHelpCatalogPreview', () => {
  it('renders real Breadcrumb and Tooltip states from canonical components', async () => {
    const breadcrumb = render(NavigationHelpCatalogPreview, {
      props: { componentId: 'breadcrumb', fixture },
    });
    expect(screen.getByRole('navigation', { name: 'Catalog path' })).not.toBeNull();
    expect(breadcrumb.container.querySelector('[aria-current="page"]')?.textContent).toContain(
      'deliberately long',
    );
    expect(breadcrumb.container.querySelector('[data-catalog-rendered-state]')).not.toBeNull();
    breadcrumb.unmount();

    let openTooltip: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      openTooltip = callback;
      return 1;
    });
    render(NavigationHelpCatalogPreview, { props: { componentId: 'tooltip', fixture } });
    expect(screen.getByRole('button', { name: 'Keyboard help' })).not.toBeNull();
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    openTooltip?.(0);
    expect((await screen.findByRole('tooltip', { hidden: true })).textContent).toContain(
      'Press Command K',
    );
  });

  it('renders semantic Kbd shortcut states through the public primitive', () => {
    const { container } = render(NavigationHelpCatalogPreview, {
      props: { componentId: 'kbd', fixture },
    });
    const chips = container.querySelectorAll('kbd[data-slot="shortcut-chip"]');
    expect([...chips].map((chip) => chip.textContent)).toEqual([
      'Esc',
      '⌘',
      'K',
      'Enter',
      'Page Down',
    ]);
    expect(screen.getByLabelText('Command K shortcut')).not.toBeNull();
  });

  it('renders and toggles the canonical collapsed Sidebar through its public API', async () => {
    stubMatchMedia(false);
    const { container } = render(NavigationHelpCatalogPreview, {
      props: { componentId: 'sidebar', fixture },
    });
    const sidebar = container.querySelector('[data-slot="sidebar"][data-state]');
    expect(sidebar?.getAttribute('data-state')).toBe('collapsed');
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('data-active')).toBe(
      'true',
    );
    await fireEvent.click(container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!);
    expect(sidebar?.getAttribute('data-state')).toBe('expanded');
    const state = screen.getByLabelText('Sidebar open state');
    expect(state.textContent?.trim()).toBe('true');
    expect(state.className).toContain('sr-only');
    expect(
      container
        .querySelector('[data-catalog-rendered-state]')
        ?.getAttribute('data-catalog-rendered-state'),
    ).toContain('actions-and-badges');
  });

  it('renders real ScrollArea orientation and no-overflow states', () => {
    const { container } = render(NavigationHelpCatalogPreview, {
      props: { componentId: 'scroll-area', fixture },
    });
    const viewports = container.querySelectorAll('[data-slot="scroll-area-viewport"]');
    expect(viewports).toHaveLength(2);
    expect(viewports[0]?.getAttribute('tabindex')).toBe('0');
    expect(
      container.querySelector('[data-slot="scroll-area"][data-orientation="both"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain('Short content does not overflow.');
  });
});
