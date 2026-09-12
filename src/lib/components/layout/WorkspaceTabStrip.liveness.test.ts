/** @vitest-environment jsdom */
import { m } from '$shared/paraglide/messages.js';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabLivenessStore } from './__tests__/mocks/workspace-tab-liveness-store';
import type { WorkspaceTabBorderMaskBounds } from './titlebar-geometry';

const mocks = vi.hoisted(() => ({
  fixture: null as ReturnType<typeof createTabLivenessStore> | null,
}));
const fixture = () => mocks.fixture!;

vi.mock('$app/navigation', () => ({
  goto: async (url: string) =>
    fixture().route.set(url.startsWith('/workspace/') ? url.split('/').at(-1)! : null),
}));
vi.mock('$store/renderer/store', () => ({
  store: {
    get state() {
      return fixture().store.state;
    },
    getReadableState: () => fixture().state,
    dispatch: (action: Parameters<ReturnType<typeof createTabLivenessStore>['dispatch']>[0]) =>
      fixture().dispatch(action),
  },
}));
vi.mock('$store/renderer/slices/tab-state/tab-state-selectors', () => ({
  selectCurrentWorkspaceTabId: Object.assign(() => fixture().current(), {
    select: () => fixture().store.state.shell.current,
  }),
  selectWorkspaceTabOrder: Object.assign(() => fixture().tabs(), {
    select: () => fixture().store.state.shell.tabs,
  }),
}));
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceItems: Object.assign(() => fixture().items(), {
    select: () => fixture().store.state.shell.items,
  }),
}));
vi.mock('$store/renderer/slices/hud/hud-selectors', () => ({
  selectWorkspaceTabStatuses: () => fixture().statuses(),
}));
vi.mock('$features/workspace/utils/empty-window-destination', () => ({
  resolveEmptyWindowDestination: () => '/',
}));
vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    startPolling() {},
    subscribe: () => () => {},
    getStreamingAgentIdsForWorkspace: () => [],
  },
}));
vi.mock('$lib/components/workspace/WorkspaceHoverCard.svelte', async () => ({
  default: (await import('./__tests__/mocks/MockWorkspaceHoverCard.svelte')).default,
}));
vi.mock('$lib/components/ui/tooltip', async () => ({
  TooltipRich: (await import('$lib/components/ui/tooltip/TooltipRich.svelte')).default,
}));
vi.mock('svelte-fa', async () => ({
  default: (await import('$lib/components/ui/__tests__/mocks/Fa.svelte')).default,
}));

import Harness from './__tests__/mocks/WorkspaceTabStripLivenessHarness.svelte';

// Do not use testing-library fireEvent/render, tick or flushSync here: an outer
// flush can rescue the stalled root and hide the regression (intent#4616).
const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (node: Element) =>
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
const tab = (id: string) =>
  document.querySelector<HTMLButtonElement>(`[data-workspace-tab="${id}"] [role="tab"]`)!;
const close = (id: string) =>
  document.querySelector<HTMLButtonElement>(
    `[data-workspace-tab="${id}"] [data-workspace-tab-close]`,
  )!;

interface HarnessView {
  target: HTMLElement;
  sidebar: HTMLButtonElement;
  local: HTMLButtonElement;
  bounds: Array<WorkspaceTabBorderMaskBounds | null>;
  deliveries: Array<string | null>;
}

async function withHarness(run: (view: HarnessView) => Promise<void>, readBeforeWrite = true) {
  mocks.fixture = createTabLivenessStore();
  const panel = fixture().panel();
  const deliveries: Array<string | null> = [];
  const stop = panel.subscribe((value) => deliveries.push(value));
  const bounds: Array<WorkspaceTabBorderMaskBounds | null> = [];
  const target = document.createElement('main');
  document.body.append(target);
  const instance = mount(Harness, {
    target,
    props: {
      route: fixture().route,
      panel,
      readBeforeWrite,
      onToggle: () => fixture().dispatch({ type: 'probe/toggle' }),
      onLeave: () => fixture().route.set(null),
      onBounds: (value) => bounds.push(value),
    },
  });
  try {
    await settle();
    await run({
      target,
      bounds,
      deliveries,
      sidebar: target.querySelector<HTMLButtonElement>('[data-sidebar]')!,
      local: target.querySelector<HTMLButtonElement>('[data-local]')!,
    });
  } finally {
    await unmount(instance);
    stop();
    fixture().dispose();
    mocks.fixture = null;
  }
}

async function expectContinuingLiveness({ sidebar, local, deliveries }: HarnessView) {
  for (let count = 1; count <= 3; count++) {
    click(sidebar);
    click(local);
    await settle();
    expect(deliveries.at(-1)).toBe(count % 2 === 1 ? 'all-workspaces' : null);
    expect(sidebar.getAttribute('aria-pressed')).toBe(String(count % 2 === 1));
    expect(local.textContent).toBe(String(count));
  }
}

describe('WorkspaceTabStrip reactive-parent liveness', () => {
  const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');

  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      const left = this.hasAttribute('data-workspace-tab')
        ? this.dataset.workspaceTab === 'a'
          ? 30
          : 200
        : 0;
      const width = this.hasAttribute('data-workspace-tab') ? 150 : 600;
      return {
        left,
        right: left + width,
        width,
        top: 0,
        bottom: 30,
        height: 30,
        x: left,
        y: 0,
        toJSON: () => ({}),
      };
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(600);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) =>
      setTimeout(() => fn(performance.now()), 16),
    );
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    } as unknown as MediaQueryList);
    Object.defineProperty(Element.prototype, 'getAnimations', {
      configurable: true,
      value: () => [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalGetAnimations)
      Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations);
    else Reflect.deleteProperty(Element.prototype, 'getAnimations');
  });

  it.each([
    ['read/write sibling', true],
    ['write-only sibling control', false],
  ] as const)(
    'keeps selector and local DOM live after null-to-active selection with a %s',
    async (_name, readBeforeWrite) => {
      await withHarness(async ({ target, sidebar, local, bounds, deliveries }) => {
        expect(tab('b').getAttribute('aria-selected')).toBe('false');
        expect(target.querySelector('[data-mask]')).toBeNull();
        const samples = [];
        for (let cycle = 0; cycle < 12; cycle++) {
          const id = cycle % 2 === 0 ? 'b' : 'a';
          click(tab(id));
          await settle(0);
          click(local);
          await settle();
          click(sidebar);
          await settle(30);
          expect(fixture().store.state.shell.current).toBe(id);
          expect(deliveries.at(-1)).toBe(cycle % 2 === 0 ? 'all-workspaces' : null);
          samples.push({
            selected: tab(id).getAttribute('aria-selected'),
            pressed: sidebar.getAttribute('aria-pressed'),
            local: local.textContent,
          });
        }
        expect(deliveries).toHaveLength(13);
        expect(bounds.some((value) => value !== null)).toBe(true);
        expect(samples).toEqual(
          Array.from({ length: 12 }, (_, cycle) => ({
            selected: 'true',
            pressed: String(cycle % 2 === 0),
            local: String(cycle + 1),
          })),
        );
        expect(target.querySelector('[data-sidebar]')).toBe(sidebar);
        expect(target.querySelector('[data-local]')).toBe(local);
      }, readBeforeWrite);
    },
  );

  it('clears the border when leaving the workspace and stays responsive on reactivation', async () => {
    await withHarness(async (view) => {
      click(tab('b'));
      await settle();
      expect(view.target.querySelector('[data-mask]')).not.toBeNull();
      view.bounds.length = 0;
      click(view.target.querySelector('[data-leave]')!);
      await settle();
      expect(view.bounds.at(-1)).toBeNull();
      expect(view.target.querySelector('[data-mask]')).toBeNull();
      expect(tab('b').getAttribute('aria-selected')).toBe('false');
      click(tab('a'));
      await settle();
      expect(tab('a').getAttribute('aria-selected')).toBe('true');
      expect(view.target.querySelector('[data-mask]')).not.toBeNull();
      await expectContinuingLiveness(view);
    });
  });

  it('reports the surviving tab immediately on close and clears bounds on the last close', async () => {
    await withHarness(async (view) => {
      click(tab('b'));
      await settle();
      view.bounds.length = 0;
      click(close('b'));
      // The imperative close controllers must still notify in the click stack,
      // not wait for a future animation frame to move the border to the survivor.
      expect(view.bounds).toContain(null);
      expect(view.bounds.at(-1)).not.toBeNull();
      await settle();
      expect(fixture().store.state.shell.tabs).toEqual(['a']);
      expect(tab('a').getAttribute('aria-selected')).toBe('true');
      expect(tab('b')).toBeNull();
      click(close('a'));
      expect(view.bounds.at(-1)).toBeNull();
      await settle();
      expect(fixture().store.state.shell.tabs).toEqual([]);
      expect(view.target.querySelector('[data-mask]')).toBeNull();
      await expectContinuingLiveness(view);
    });
  });

  it.each(['others', 'right'] as const)(
    'keeps the border and shell live when bulk-closing %s including the active tab',
    async (mode) => {
      await withHarness(async (view) => {
        click(tab('b'));
        await settle();
        tab('a').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await settle();
        const label =
          mode === 'others'
            ? m.layout_panelTabBar_closeAllOthers_label()
            : m.layout_panelTabBar_closeTabsToRight_label();
        const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(
          (node) => node.textContent?.trim() === label,
        )!;
        view.bounds.length = 0;
        click(item);
        expect(view.bounds).toContain(null);
        expect(view.bounds.at(-1)).not.toBeNull();
        await settle();
        expect(fixture().store.state.shell.tabs).toEqual(['a']);
        expect(fixture().store.state.shell.current).toBe('a');
        expect(tab('a').getAttribute('aria-selected')).toBe('true');
        expect(view.target.querySelector('[data-mask]')).not.toBeNull();
        await expectContinuingLiveness(view);
      });
    },
  );
});
