/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$features/layout/tab-types/registry', () => ({
  tabTypeRegistry: { getIcon: () => null, getSidebarTabId: () => null },
}));

import PaneStackControlHost from './mocks/PaneStackControlHost.svelte';

const panelTypes = [
  'agent',
  'browser',
  'terminal',
  'note',
  'file',
  'diff',
  'changes',
  'local-changes',
  'chat-changes',
  'settings',
  'overview',
  'hook-script',
  'activity',
  'activity-changes',
  'code-review',
  'agent-overview',
  'task',
] as const;

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
  it('keeps shared stack semantics without legacy overlay metadata', () => {
    const { container } = render(PaneStackControlHost, {
      props: { stackCount: 2, initialActiveTabId: 'agent-pane' },
    });
    const header = container.querySelector('[data-panel-tabless-header]')!;

    expect(header.querySelectorAll('[data-testid="panel-header-agent-avatar-slot"]')).toHaveLength(
      1,
    );
    expect(header.querySelector('[data-panel-agent-header-identity]')).not.toBeNull();
    expect(header.textContent).toContain('Build agent');
    expect(header.textContent).not.toContain('Release plan');
    expect(header.getAttribute('role')).toBe('group');
    expect(header.getAttribute('aria-label')).toBe('Pane stack size: 2');
    expect(header.getAttribute('data-pane-stack-size')).toBe('2');
    const active = header.querySelector('[data-pane-stack-active="agent-pane"]');
    expect(active).not.toBeNull();
    expect(active?.getAttribute('aria-current')).toBe('true');
    expect(screen.getByTestId('pane-stack-selector-trigger')).not.toBeNull();
    expect(header.querySelector('[data-pane-stack]')).toBeNull();
    expect(header.querySelector('[data-pane-stack-layer]')).toBeNull();
    expect(header.querySelector('[data-pane-stack-position]')).toBeNull();
    expect(header.querySelector('[data-pane-stack-overflow-trigger]')).toBeNull();
  });

  it.each(panelTypes)('shows the selector for a stacked active %s pane', (type) => {
    const fallback = type === 'note' ? 'browser' : 'note';
    const { container } = render(PaneStackControlHost, {
      props: {
        paneTypes: [type, fallback],
        stackCount: 2,
        initialActiveTabId: `${type}-pane`,
      },
    });
    const header = container.querySelector('[data-panel-tabless-header]')!;

    expect(header.getAttribute('role')).toBe('group');
    expect(header.getAttribute('aria-label')).toBe('Pane stack size: 2');
    expect(header.getAttribute('data-pane-stack-size')).toBe('2');
    expect(header.querySelector(`[data-pane-stack-active="${type}-pane"]`)).not.toBeNull();
    expect(screen.getByTestId('pane-stack-selector-trigger')).not.toBeNull();
  });

  it.each(panelTypes)('hides the selector for a single active %s pane', (type) => {
    const { container } = render(PaneStackControlHost, {
      props: {
        paneTypes: [type],
        stackCount: 1,
        initialActiveTabId: `${type}-pane`,
      },
    });

    expect(
      container.querySelector('[data-pane-stack-size]')?.getAttribute('data-pane-stack-size'),
    ).toBe('1');
    expect(screen.queryByTestId('pane-stack-selector-trigger')).toBeNull();
  });

  it('shows one flat active pane and one complete selector', () => {
    const { container } = render(PaneStackControlHost);
    const stack = container.querySelector('[data-pane-stack]')!;
    const active = stack.querySelector('[data-pane-stack-active]')!;
    const trigger = screen.getByTestId('pane-stack-selector-trigger');

    expect(stack.getAttribute('aria-label')).toBe('Pane stack size: 5');
    expect(stack.querySelector('[data-pane-stack-layer]')).toBeNull();
    expect(active.getAttribute('data-pane-stack-active')).toBe('note-pane');
    expect(active.getAttribute('aria-current')).toBe('true');
    expect(active.textContent).toContain('Release plan');
    expect(active.querySelector('[data-pane-stack-position]')).toBeNull();
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.querySelector('[data-pane-stack-selector-chevron]')).toBeNull();
    expect(trigger.querySelectorAll('[data-pane-stack-line]')).toHaveLength(5);
    expect(container.querySelector('[data-panel-identity-back]')).toBeNull();
    expect(container.querySelector('[data-panel-identity-forward]')).toBeNull();
  });

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

  it('preserves agent identity and menu order in the complete list', async () => {
    render(PaneStackControlHost);
    await fireEvent.click(screen.getByTestId('pane-stack-selector-trigger'));
    const menu = await screen.findByRole('menu', { name: 'Panes in this stack' });
    const items = Array.from(menu.querySelectorAll('[data-pane-stack-item]'));

    expect(items.map((item) => item.getAttribute('data-pane-stack-item'))).toEqual([
      'agent-pane',
      'note-pane',
      'file-pane',
      'browser-pane',
      'terminal-pane',
    ]);
    const agentItem = menu.querySelector('[data-pane-stack-item="agent-pane"]')!;
    expect(agentItem.textContent).toContain('Build agent');
    expect(
      agentItem.querySelector('[data-pane-stack-item-identity="agent"] [data-agent-avatar]'),
    ).not.toBeNull();
    expect(agentItem.querySelector('[data-panel-agent-chat-glyph]')).toBeNull();
  });

  it('updates the selector when panes are added and removed', async () => {
    const view = render(PaneStackControlHost, {
      props: { paneTypes: ['note'], stackCount: 1, initialActiveTabId: 'note-pane' },
    });
    expect(screen.queryByTestId('pane-stack-selector-trigger')).toBeNull();

    await view.rerender({ paneTypes: ['note', 'browser'], stackCount: 2 });
    expect(screen.getByTestId('pane-stack-selector-trigger')).not.toBeNull();
    expect(
      screen.getByTestId('pane-stack-selector-trigger').querySelectorAll('[data-pane-stack-line]'),
    ).toHaveLength(2);

    await fireEvent.click(screen.getByTestId('pane-stack-selector-trigger'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Preview browser' }));
    expect(view.container.firstElementChild?.getAttribute('data-active-tab')).toBe('browser-pane');

    await view.rerender({ paneTypes: ['browser'], stackCount: 1 });
    await waitFor(() => expect(screen.queryByTestId('pane-stack-selector-trigger')).toBeNull());
    expect(view.container.firstElementChild?.getAttribute('data-active-tab')).toBe('browser-pane');
  });

  it('opens the complete list from the keyboard and restores trigger focus on dismiss', async () => {
    render(PaneStackControlHost);
    const trigger = screen.getByTestId('pane-stack-selector-trigger');
    expect(trigger.textContent?.trim()).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('Show pane list. Total panes: 5.');

    trigger.focus();
    await fireEvent.focus(trigger);
    expect((await screen.findByRole('tooltip', { hidden: true })).textContent).toContain(
      'Show pane list. Total panes: 5.',
    );
    await fireEvent.keyDown(trigger, { key: 'Enter' });
    const menu = await screen.findByRole('menu', { name: 'Panes in this stack' });
    expect(menu.querySelectorAll('[data-pane-stack-item]')).toHaveLength(5);
    expect(
      menu.querySelector('[data-pane-stack-item="note-pane"]')?.getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByRole('menuitem', { name: 'Open panel above' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Open panel below' })).toBeTruthy();
    expect(menu.textContent).not.toContain(
      'Use Up or Down to move, Enter to select, and Escape to close.',
    );

    await fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(trigger);
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
