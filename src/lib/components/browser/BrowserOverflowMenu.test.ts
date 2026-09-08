import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import BrowserOverflowMenu from './BrowserOverflowMenu.svelte';

afterEach(cleanup);

describe('BrowserOverflowMenu', () => {
  it('renders actions and the first separator in the required order', async () => {
    render(BrowserOverflowMenu, {
      props: {
        onOpenExternal: vi.fn(),
        onCopyUrl: vi.fn(),
        onScreenshot: vi.fn(),
        onOpenConsole: vi.fn(),
        onOpenSource: vi.fn(),
        onOpenInspector: vi.fn(),
        onReloadWithoutCache: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByTestId('browser-overflow-trigger'));

    const external = await screen.findByRole('menuitem', {
      name: 'Open in external browser',
    });
    const copy = screen.getByRole('menuitem', { name: 'Copy URL' });
    const screenshot = screen.getByRole('menuitem', { name: 'Screenshot' });
    const consoleItem = screen.getByRole('menuitem', { name: 'Console' });
    const source = screen.getByRole('menuitem', { name: 'Source' });
    const inspector = screen.getByRole('menuitem', { name: 'Inspector' });
    const reload = screen.getByRole('menuitem', { name: 'Reload without cache' });
    const firstSeparator = screen.getAllByRole('group')[0];

    expect(screen.getAllByRole('menuitem')).toEqual([
      external,
      copy,
      screenshot,
      consoleItem,
      source,
      inspector,
      reload,
    ]);
    expect(copy.nextElementSibling).toBe(firstSeparator);
    expect(firstSeparator.nextElementSibling).toBe(screenshot);
  });

  it('places collapsed toolbar actions before the existing menu section', async () => {
    render(BrowserOverflowMenu, {
      props: {
        collapsed: true,
        canGoBack: true,
        canGoForward: true,
        canSelectElement: true,
        onGoBack: vi.fn(),
        onGoForward: vi.fn(),
        onToggleElementPicker: vi.fn(),
        onViewportChange: vi.fn(),
        onOpenExternal: vi.fn(),
        onCopyUrl: vi.fn(),
        onScreenshot: vi.fn(),
        onOpenConsole: vi.fn(),
        onOpenSource: vi.fn(),
        onOpenInspector: vi.fn(),
        onReloadWithoutCache: vi.fn(),
      },
    });

    await fireEvent.click(screen.getByTestId('browser-overflow-trigger'));

    const back = await screen.findByRole('menuitem', { name: 'Go back' });
    const forward = screen.getByRole('menuitem', { name: 'Go forward' });
    const picker = screen.getByRole('menuitem', { name: 'Select an element from the page' });
    const viewport = screen.getByRole('menuitem', { name: 'Viewport mode: Fit panel' });
    const external = screen.getByRole('menuitem', { name: 'Open in external browser' });

    expect(screen.getAllByRole('menuitem').slice(0, 5)).toEqual([
      back,
      forward,
      picker,
      viewport,
      external,
    ]);
    expect(viewport.nextElementSibling?.getAttribute('data-slot')).toBe('menu-separator');
  });
});
