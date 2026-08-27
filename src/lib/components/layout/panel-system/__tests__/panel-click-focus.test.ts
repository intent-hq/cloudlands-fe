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

function panel(id: string): PanelState {
  return {
    id,
    tabs: [{ id: `${id}-tab`, type: 'note', title: id, closable: true }],
    activeTabId: `${id}-tab`,
  };
}

function pointerDown(element: Element) {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
}

afterEach(cleanup);

describe('panel click focus routing', () => {
  it('activates left, middle, and right controls once while preserving DOM focus', async () => {
    const columns = ['left', 'middle', 'right'].map((id) => {
      const onFocus = vi.fn();
      const view = render(Panel, {
        props: { panel: panel(id), workspaceId: 'workspace-1', layoutId: 'workspace-1', onFocus },
      });
      return { ...view, id, onFocus };
    });

    for (const column of columns) {
      const control = column.container.querySelector<HTMLInputElement>(
        '[data-panel-focus-content-control]',
      )!;
      pointerDown(control);
      control.focus();
      await Promise.resolve();

      expect(column.onFocus, column.id).toHaveBeenCalledTimes(1);
      expect(document.activeElement, column.id).toBe(control);
    }
  });

  it('activates non-interactive header and background surfaces', () => {
    const onFocus = vi.fn();
    const { container } = render(Panel, {
      props: {
        panel: panel('surface'),
        workspaceId: 'workspace-1',
        layoutId: 'workspace-1',
        onFocus,
      },
    });
    const root = container.querySelector('[data-panel-id="surface"]')!;
    const header = container.querySelector('[data-panel-header]')!;

    pointerDown(header);
    pointerDown(root);

    expect(onFocus).toHaveBeenCalledTimes(2);
  });
});
