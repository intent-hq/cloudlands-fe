/** @vitest-environment jsdom */
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  PanelLayoutNode,
  PanelState,
} from '$store/renderer/slices/panel-layout/panel-layout-types';

const readable = <T>(value: T) => ({
  subscribe(run: (current: T) => void) {
    run(value);
    return () => {};
  },
});

vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectIsDragging: () => readable(false),
}));

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/MockMountedPanel.svelte')).default,
}));

import PanelContainer from '../PanelContainer.svelte';

const panel = (id: string): PanelState => ({ id, tabs: [], activeTabId: null });
const panelNode = (panelId: string): PanelLayoutNode => ({ type: 'panel', panelId });

function props(node: PanelLayoutNode, panelOrder: string[]) {
  return {
    node,
    panels: Object.fromEntries(panelOrder.map((id) => [id, panel(id)])),
    panelOrder,
    focusedPanelId: null,
    workspaceId: 'rightmost-workspace',
    layoutId: 'rightmost-workspace',
    suppressLayoutMotion: true,
  };
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations');
  vi.unstubAllGlobals();
});

describe('rightmost panel ownership routing', () => {
  it('marks the sole panel as rightmost', () => {
    const { container } = render(PanelContainer, { props: props(panelNode('only'), ['only']) });

    expect(container.querySelectorAll('[data-rightmost="true"]')).toHaveLength(1);
    expect(
      container.querySelector('[data-mounted-panel="only"]')?.getAttribute('data-rightmost'),
    ).toBe('true');
  });

  it('follows panelOrder and never renders more than one selector', async () => {
    const root: PanelLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [panelNode('left'), panelNode('right')],
      sizes: [50, 50],
    };
    const view = render(PanelContainer, { props: props(root, ['left', 'right']) });

    expect(view.container.querySelectorAll('[data-rightmost="true"]')).toHaveLength(1);
    expect(
      view.container.querySelector('[data-mounted-panel="right"]')?.getAttribute('data-rightmost'),
    ).toBe('true');

    await view.rerender(props(root, ['right', 'left']));
    await waitFor(() =>
      expect(
        view.container.querySelector('[data-mounted-panel="left"]')?.getAttribute('data-rightmost'),
      ).toBe('true'),
    );
    expect(view.container.querySelectorAll('[data-rightmost="true"]')).toHaveLength(1);

    const withThird: PanelLayoutNode = {
      ...root,
      children: [...root.children, panelNode('third')],
      sizes: [33, 33, 34],
    };
    await view.rerender(props(withThird, ['right', 'left', 'third']));
    await waitFor(() =>
      expect(
        view.container
          .querySelector('[data-mounted-panel="third"]')
          ?.getAttribute('data-rightmost'),
      ).toBe('true'),
    );
    expect(view.container.querySelectorAll('[data-rightmost="true"]')).toHaveLength(1);

    await view.rerender(props(root, ['right', 'left']));
    await waitFor(() =>
      expect(view.container.querySelector('[data-mounted-panel="third"]')).toBeNull(),
    );
    expect(
      view.container.querySelector('[data-mounted-panel="left"]')?.getAttribute('data-rightmost'),
    ).toBe('true');
    expect(view.container.querySelectorAll('[data-rightmost="true"]')).toHaveLength(1);
  });
});
