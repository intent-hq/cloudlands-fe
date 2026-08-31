/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(cleanup);

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
