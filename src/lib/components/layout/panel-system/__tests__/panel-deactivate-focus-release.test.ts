/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import type { PanelState } from '$store/renderer/slices/panel-layout/panel-layout-types';

const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn(), state: {} },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(false),
}));
vi.mock('../PanelTabBar.svelte', async () => ({
  default: (await import('./mocks/PanelFocusHeader.svelte')).default,
}));
vi.mock('../PanelContentRenderer.svelte', async () => ({
  default: (await import('./mocks/PanelFocusContent.svelte')).default,
}));
vi.mock('../PanelEmptyState.svelte', async () => ({
  default: (await import('./mocks/PanelFocusContent.svelte')).default,
}));

import Panel from '../Panel.svelte';

/**
 * Regression tests for the panel-deactivation focus release: flipping `inert`
 * on a `.tab-content-wrapper` that still contains the focused element makes
 * the browser blur it synchronously inside the template effect, where widgets
 * that write $state on blur (e.g. TipTap) throw state_unsafe_mutation. The
 * $effect.pre in Panel.svelte must blur the focused wrapper descendant
 * *before* the wrapper's `inert` attribute updates.
 */

function panelState(id: string): PanelState {
  return {
    id,
    tabs: [{ id: `${id}-tab`, type: 'note', title: id, closable: true }],
    activeTabId: `${id}-tab`,
  };
}

function baseProps(active: boolean) {
  return {
    panel: panelState('deactivate'),
    workspaceId: 'workspace-1',
    layoutId: 'workspace-1',
    active,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('panel deactivation focus release', () => {
  it('blurs focus inside the tab-content-wrapper before inert applies when active flips false', async () => {
    const view = render(Panel, { props: baseProps(true) });
    const control = view.container.querySelector<HTMLInputElement>(
      '[data-panel-focus-content-control]',
    )!;
    const wrapper = view.container.querySelector<HTMLElement & { inert: boolean }>(
      '.tab-content-wrapper',
    )!;
    control.focus();
    expect(document.activeElement).toBe(control);
    expect(wrapper.inert).toBe(false);

    let wrapperInertAtBlur: boolean | null = null;
    control.addEventListener('blur', () => {
      wrapperInertAtBlur = wrapper.inert;
    });

    await view.rerender(baseProps(false));

    expect(document.activeElement).not.toBe(control);
    expect(wrapperInertAtBlur).toBe(false);
    expect(wrapper.inert).toBe(true);
  });

  it('keeps focus on header controls outside the wrappers when the panel deactivates', async () => {
    const view = render(Panel, { props: baseProps(true) });
    const headerControl = view.container.querySelector<HTMLButtonElement>(
      '[data-panel-focus-header-control]',
    )!;
    headerControl.focus();
    expect(document.activeElement).toBe(headerControl);

    await view.rerender(baseProps(false));

    expect(document.activeElement).toBe(headerControl);
  });
});

describe('inactive panel content retention', () => {
  it.each(['note', 'file', 'diff'] as const)(
    'starts the selected %s inactivity window when the workspace deactivates',
    async (type) => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      const props = (active: boolean) => ({
        ...baseProps(active),
        panel: {
          id: 'retained',
          tabs: [{ id: 'editor', type, title: 'Editor', closable: true }],
          activeTabId: 'editor',
        },
      });
      const view = render(Panel, { props: props(true) });
      const content = view.container.querySelector('[data-tab-id="editor"]')!;
      expect(content).not.toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      await view.rerender(props(false));
      await vi.advanceTimersByTimeAsync(29_999);
      await tick();
      expect(view.container.querySelector('[data-tab-id="editor"]')).toBe(content);
      await view.rerender(props(false));
      await vi.advanceTimersByTimeAsync(1);
      await tick();
      expect(content.isConnected).toBe(false);
    },
  );

  it('expires notes, files and diffs while preserving the browser instance across workspace switches', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const tabs: PanelState['tabs'] = [
      { id: 'browser', type: 'browser', title: 'Browser', closable: true },
      { id: 'note', type: 'note', title: 'Note', closable: true },
      { id: 'file', type: 'file', title: 'File', closable: true },
      { id: 'diff', type: 'diff', title: 'Diff', closable: true },
      { id: 'unvisited', type: 'note', title: 'Unvisited', closable: true },
    ];
    const props = (activeTabId: string, active = true) => ({
      ...baseProps(active),
      panel: { id: 'retained', tabs, activeTabId },
    });
    const view = render(Panel, { props: props('browser') });
    const browser = view.container.querySelector('[data-tab-id="browser"]')!;
    expect(browser).not.toBeNull();
    for (const id of ['note', 'file', 'diff']) {
      await view.rerender(props(id));
    }
    const cachedContent = ['note', 'file', 'diff'].map((id) =>
      view.container.querySelector(`[data-tab-id="${id}"]`),
    );
    expect(cachedContent.every((node) => node?.isConnected)).toBe(true);

    await view.rerender(props('diff', false));
    await vi.advanceTimersByTimeAsync(30_000);
    await tick();

    expect(cachedContent.every((node) => !node?.isConnected)).toBe(true);
    expect(browser.isConnected).toBe(true);
    expect(view.container.querySelector('[data-tab-id="unvisited"]')).toBeNull();

    await view.rerender(props('diff'));
    expect(view.container.querySelector('[data-tab-id="diff"]')).not.toBeNull();
    expect(view.container.querySelector('[data-tab-id="diff"]')).not.toBe(cachedContent[2]);
    expect(view.container.querySelector('[data-tab-id="browser"]')).toBe(browser);
  });

  it('cancels selected-content eviction when the workspace returns before expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const view = render(Panel, { props: baseProps(true) });
    const content = view.container.querySelector('[data-tab-id="deactivate-tab"]');
    expect(content).not.toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await view.rerender(baseProps(false));
    await vi.advanceTimersByTimeAsync(15_000);
    await view.rerender(baseProps(true));
    await vi.advanceTimersByTimeAsync(30_000);
    await tick();
    expect(view.container.querySelector('[data-tab-id="deactivate-tab"]')).toBe(content);
  });
});
