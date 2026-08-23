/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$features/layout/tab-types/registry', () => ({
  tabTypeRegistry: { getIcon: () => null, getSidebarTabId: () => null },
}));

import PaneStackControlHost from './mocks/PaneStackControlHost.svelte';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pane stack control', () => {
  it('shows two labeled layers with the active pane in front', () => {
    const { container } = render(PaneStackControlHost);
    const stack = container.querySelector('[data-pane-stack]')!;
    const layers = Array.from(stack.querySelectorAll('[data-pane-stack-layer]'));
    const active = stack.querySelector('[data-pane-stack-active]')!;

    expect(stack.getAttribute('aria-label')).toBe('Pane stack size: 5');
    expect(layers).toHaveLength(2);
    expect(layers.map((layer) => layer.textContent?.trim())).toEqual([
      'Preview browser',
      'Development server',
    ]);
    expect(active.getAttribute('data-pane-stack-active')).toBe('note-pane');
    expect(active.textContent).toContain('Release plan');
    expect(active.querySelector('[data-pane-stack-position]')?.textContent?.trim()).toBe('2/5');
    expect(active.classList.contains('z-10')).toBe(true);
    expect(container.querySelector('[data-panel-identity-back]')).toBeNull();
    expect(container.querySelector('[data-panel-identity-forward]')).toBeNull();
  });

  it('uses native buttons as direct layer targets', async () => {
    const { container } = render(PaneStackControlHost);
    const browser = screen.getByRole('button', { name: /Open pane Preview browser/ });
    expect(browser.getAttribute('type')).toBe('button');
    await fireEvent.click(browser);
    expect(container.firstElementChild?.getAttribute('data-active-tab')).toBe('browser-pane');

    const server = screen.getByRole('button', { name: /Open pane Development server/ });
    server.focus();
    expect(document.activeElement).toBe(server);
  });

  it('opens the complete stack list from the keyboard and selects a pane', async () => {
    const { container } = render(PaneStackControlHost);
    const trigger = screen.getByTestId('pane-stack-overflow-trigger');
    expect(trigger.textContent?.trim()).toBe('+2');
    expect(trigger.getAttribute('aria-label')).toBe(
      'Show all panes. Stack size: 5. Hidden layers: 2.',
    );

    trigger.focus();
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu', { name: 'Panes in this stack' });
    expect(menu.querySelectorAll('[data-pane-stack-item]')).toHaveLength(5);
    expect(
      menu.querySelector('[data-pane-stack-item="note-pane"]')?.getAttribute('aria-current'),
    ).toBe('page');
    expect(menu.textContent).toContain(
      'Use Up or Down to move, Enter to select, and Escape to close.',
    );

    await fireEvent.click(menu.querySelector('[data-pane-stack-item="file-pane"]')!);
    expect(container.firstElementChild?.getAttribute('data-active-tab')).toBe('file-pane');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('surfaces attention and closes only the active pane', async () => {
    const { container } = render(PaneStackControlHost, {
      props: { attentionTabIds: ['agent-pane', 'browser-pane'] },
    });
    expect(
      container
        .querySelector('[data-pane-stack-layer="browser-pane"]')
        ?.hasAttribute('data-attention'),
    ).toBe(true);
    const trigger = screen.getByTestId('pane-stack-overflow-trigger');
    expect(trigger.hasAttribute('data-attention')).toBe(true);
    await fireEvent.click(trigger);
    expect(
      screen
        .getByRole('menuitem', { name: 'Build agent. Needs attention.' })
        .hasAttribute('data-attention'),
    ).toBe(true);
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await fireEvent.click(
      container.querySelector('[data-panel-tabless-header] [data-testid="panel-close-button"]')!,
    );
    expect(container.firstElementChild?.getAttribute('data-last-closed-tab')).toBe('note-pane');
    expect(container.firstElementChild?.getAttribute('data-close-panel-count')).toBe('0');
  });
});
