/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReduxStoreContext } from '$store/renderer/types';
import { initAppStore, store as appStore } from '$store/renderer/store';
import {
  closePanel,
  initializeLayout,
  setRestoreStatus,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import type { PanelLayoutNode } from '$store/renderer/slices/panel-layout/panel-layout-types';

vi.mock('../Panel.svelte', async () => ({
  default: (await import('./mocks/MockMountedPanel.svelte')).default,
}));

import PanelLayout from '../PanelLayout.svelte';

const STORE_CONTEXT = 'redux-store-context';
const GUTTER = 8;
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
let storeContext: ReduxStoreContext | undefined;
let testSequence = 0;

const source = (file: string) => readFileSync(resolve(__dirname, `../${file}`), 'utf8');

class TestResizeObserver {
  observe() {}
  disconnect() {}
}

function flexBasis(element: HTMLElement): number {
  return Number.parseFloat(element.style.flex.match(/([\d.]+)px/)?.[1] ?? '0');
}

function survivorWrapper(panelId: string): HTMLElement {
  const panel = document.querySelector<HTMLElement>(`[data-mounted-panel="${panelId}"]`);
  return panel!.closest<HTMLElement>('.panel-split-child')!;
}

function initialize(root: PanelLayoutNode, panelIds: string[], canvasWidth: number) {
  const workspaceId = `close-collapse-${++testSequence}`;
  appStore.dispatch(
    initializeLayout(workspaceId, {
      root,
      panels: Object.fromEntries(
        panelIds.map((panelId) => [
          panelId,
          {
            id: panelId,
            tabs: [{ id: `${panelId}-tab`, type: 'note', title: panelId, closable: true }],
            activeTabId: `${panelId}-tab`,
          },
        ]),
      ),
      focusedPanelId: panelIds[0],
      canvasWidth,
    }),
  );
  appStore.dispatch(setRestoreStatus(workspaceId, 'restored'));
  return workspaceId;
}

async function mount(workspaceId: string) {
  const result = render(PanelLayout, {
    props: { workspaceId, layoutId: workspaceId, contained: false, canvasSizing: 'viewport' },
    context: new Map([[STORE_CONTEXT, storeContext]]),
  });
  await waitFor(() =>
    expect(document.querySelectorAll('[data-mounted-panel]').length).toBeGreaterThan(1),
  );
  // Let the lifecycle-motion latch arm so close runs the animated code path.
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
  return result;
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
  // Mirror real gutter geometry: a vertical gutter spans the full container
  // width (8px tall); a horizontal gutter is 8px wide.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
    if (this.classList.contains('panel-split-handle-wrapper')) {
      return this.classList.contains('vertical') ? VIEWPORT_WIDTH : GUTTER;
    }
    return Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    if (this.classList.contains('panel-split-handle-wrapper')) {
      return this.classList.contains('vertical') ? GUTTER : VIEWPORT_HEIGHT;
    }
    return Number.parseFloat(this.style.height) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function () {
    return this.dataset.testid === 'panel-workspace-inset'
      ? VIEWPORT_WIDTH
      : Number.parseFloat(this.style.width) || 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function () {
    return this.dataset.testid === 'panel-workspace-inset'
      ? VIEWPORT_HEIGHT
      : Number.parseFloat(this.style.height) || 0;
  });
  storeContext = initAppStore(appStore);
});

afterEach(() => {
  cleanup();
  storeContext?.dispose();
  storeContext = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('closing a panel that collapses a split', () => {
  it('keeps the bottom panel visible after closing the top panel of a vertical stack', async () => {
    const workspaceId = initialize(
      {
        type: 'split',
        direction: 'vertical',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
      },
      ['p1', 'p2'],
      VIEWPORT_WIDTH,
    );
    await mount(workspaceId);

    // Repro path: the panel close button (not Redux dispatch) so the close
    // flows through handleClosePanel.
    const closeButton = document
      .querySelector<HTMLElement>('[data-mounted-panel="p1"]')!
      .querySelector<HTMLButtonElement>('[data-panel-close]')!;
    await fireEvent.click(closeButton);

    await waitFor(() =>
      expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(1),
    );
    // The exiting vertical gutter (full container width mid-outro) must not
    // corrupt the re-measured reference size and collapse the survivor to ~1px.
    await waitFor(() => expect(flexBasis(survivorWrapper('p2'))).toBeCloseTo(VIEWPORT_WIDTH, 3));
  });

  it('gives the survivor the full reference size after closing a horizontal sibling', async () => {
    const workspaceId = initialize(
      {
        type: 'split',
        direction: 'horizontal',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
      },
      ['p1', 'p2'],
      VIEWPORT_WIDTH,
    );
    await mount(workspaceId);

    appStore.dispatch(closePanel(workspaceId, 'p1'));

    await waitFor(() =>
      expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(1),
    );
    // The exiting 8px horizontal gutter must not be subtracted from the
    // re-measured reference size: nothing re-measures after its outro ends,
    // which would leave the survivor permanently short by the gutter width.
    const expectedReference = VIEWPORT_WIDTH;
    await waitFor(() =>
      expect(flexBasis(survivorWrapper('p2'))).toBeCloseTo(expectedReference, 3),
    );
  });

  it('keeps the bottom panel visible after closing the top panel final tab', async () => {
    // Closing a panel's final tab removes the panel through the closeTab
    // reducer (closePanelHelper), so it collapses the split exactly like a
    // panel close and must survive the same exiting-gutter measurement.
    const workspaceId = initialize(
      {
        type: 'split',
        direction: 'vertical',
        sizes: [50, 50],
        children: [
          { type: 'panel', panelId: 'p1' },
          { type: 'panel', panelId: 'p2' },
        ],
      },
      ['p1', 'p2'],
      VIEWPORT_WIDTH,
    );
    await mount(workspaceId);

    const tabCloseButton = document
      .querySelector<HTMLElement>('[data-mounted-panel="p1"]')!
      .querySelector<HTMLButtonElement>('[data-tab-close]')!;
    await fireEvent.click(tabCloseButton);

    await waitFor(() =>
      expect(document.querySelectorAll('[data-mounted-panel]')).toHaveLength(1),
    );
    await waitFor(() => expect(flexBasis(survivorWrapper('p2'))).toBeCloseTo(VIEWPORT_WIDTH, 3));
  });

  it('commits a close-button panel close without replaying layout motion', () => {
    // Mechanism guard for the sibling flicker: during the removed wrapper's
    // exit outro the survivor already carries its new (larger) pixel basis,
    // overflowing the canvas and shifting/clipping the survivor for the exit
    // duration. handleClosePanel must commit through the motion-suppressing
    // commit helper so the collapse applies in a single un-animated frame.
    const layout = source('PanelLayout.svelte');
    expect(layout).toMatch(
      /function handleClosePanel\([\s\S]{0,400}?commitPanelMoveWithoutReplay\(/,
    );
  });

  it('commits a final-tab close that collapses a split without replaying layout motion', () => {
    // Same flicker mechanism via the tab-close route: closing the final tab
    // removes the panel inside the closeTab reducer, so handleTabClose must
    // route the collapsing case through the motion-suppressing helper too.
    const layout = source('PanelLayout.svelte');
    expect(layout).toMatch(
      /function handleTabClose\([\s\S]{0,700}?commitPanelMoveWithoutReplay\(/,
    );
  });
});
