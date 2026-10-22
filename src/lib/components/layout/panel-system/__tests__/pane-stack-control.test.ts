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
  it('selects a pane from the complete list with a pointer', async () => {
    const { container } = render(PaneStackControlHost);
    const trigger = screen.getByTestId('pane-stack-selector-trigger');
    await fireEvent.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Panes in this stack' });
    expect(menu.querySelectorAll('[data-pane-stack-item]')).toHaveLength(5);
    await fireEvent.click(menu.querySelector('[data-pane-stack-item="browser-pane"]')!);
    expect(container.firstElementChild?.getAttribute('data-active-tab')).toBe('browser-pane');
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('preserves agent identity in the complete list', async () => {
    render(PaneStackControlHost);
    await fireEvent.click(screen.getByTestId('pane-stack-selector-trigger'));
    const menu = await screen.findByRole('menu', { name: 'Panes in this stack' });
    const agentItem = menu.querySelector('[data-pane-stack-item="agent-pane"]')!;
    expect(agentItem.textContent).toContain('Build agent');
    expect(
      agentItem.querySelector('[data-pane-stack-item-identity="agent"] [data-agent-avatar]'),
    ).not.toBeNull();
    expect(agentItem.querySelector('[data-panel-agent-chat-glyph]')).toBeNull();
  });

  it('surfaces attention and closes only the active pane', async () => {
    const { container } = render(PaneStackControlHost, {
      props: { attentionTabIds: ['agent-pane', 'browser-pane'] },
    });
    expect(container.querySelector('[data-pane-stack-layer]')).toBeNull();
    const trigger = screen.getByTestId('pane-stack-selector-trigger');
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
