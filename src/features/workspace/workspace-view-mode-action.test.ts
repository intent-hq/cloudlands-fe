/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelWorkspaceViewModeTransition,
  setWorkspaceViewModeWithTransition,
  toggleWorkspaceViewModeWithTransition,
} from './workspace-view-mode-action';
import {
  getWorkspaceContentViewTransitionName,
  getWorkspaceViewTransitionName,
  WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME,
} from '$lib/components/workspace/workspace-view-transition';

type Mode = 'single' | 'columns';

function rect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    right: left + width,
    top: 0,
    bottom: 400,
    width,
    height: 400,
    toJSON: () => ({}),
  } as DOMRect;
}

function createStore(initialMode: Mode, activeId = 'ws-2') {
  let mode = initialMode;
  const dispatch = vi.fn((action: { payload: [Mode] }) => {
    mode = action.payload[0];
  });
  return {
    store: {
      get state() {
        return { tabState: { viewMode: mode, currentTabId: activeId } } as never;
      },
      dispatch,
    },
    dispatch,
    get mode() {
      return mode;
    },
  };
}

function renderMode(
  mode: Mode,
  ids: string[],
  activeId: string,
  positions: Partial<Record<Mode, Record<string, number>>> = {},
) {
  const existingMain = document.querySelector<HTMLElement>('main.workspace-main');
  document.body.replaceChildren();
  const titlebar = document.createElement('div');
  titlebar.dataset.titlebarWorkspaceControls = '';
  const sidebar = document.createElement('div');
  sidebar.dataset.sidebarPanelFrame = '';
  const main = existingMain ?? document.createElement('main');
  main.className = 'workspace-main rounded-xl bg-sidebar border border-border shadow-sm';
  main.getBoundingClientRect = () => rect(0, 600);
  const scroller = document.createElement('div');
  scroller.dataset[mode === 'single' ? 'workspaceTabStrip' : 'workspaceColumns'] = '';
  Object.defineProperties(scroller, {
    clientWidth: { configurable: true, value: 600 },
    scrollWidth: { configurable: true, value: 1800 },
    scrollLeft: { configurable: true, writable: true, value: 0 },
  });
  scroller.getBoundingClientRect = () => rect(0, 600);

  ids.forEach((id, index) => {
    const workspace = document.createElement(mode === 'single' ? 'div' : 'section');
    workspace.dataset[mode === 'single' ? 'workspaceTab' : 'workspaceColumn'] = id;
    if (mode === 'columns') {
      workspace.dataset.workspaceTransitionChrome = id;
      workspace.dataset.workspaceSurfaceState = 'live';
      workspace.className = 'rounded-xl bg-sidebar border border-border shadow-sm';
    }
    workspace.dataset.active = String(id === activeId);
    workspace.tabIndex = mode === 'columns' ? -1 : 0;
    const baseLeft = positions[mode]?.[id] ?? index * (mode === 'single' ? 160 : 420);
    const width = mode === 'single' ? 160 : 400;
    workspace.getBoundingClientRect = () => rect(baseLeft - scroller.scrollLeft, width);
    if (mode === 'single') {
      const button = document.createElement('button');
      button.setAttribute('role', 'tab');
      workspace.append(button);
    } else {
      const content = document.createElement('div');
      content.dataset.workspaceTransitionContent = id;
      workspace.append(content);
    }
    scroller.append(workspace);
  });
  document.body.append(titlebar, sidebar, scroller, main);
  return scroller;
}

function findVisibleDestination(mode: Mode, activeId: string): HTMLElement | null {
  return mode === 'single'
    ? document.querySelector<HTMLElement>('main.workspace-main')
    : document.querySelector<HTMLElement>(`[data-workspace-column="${activeId}"]`);
}

function installViewTransition(
  inspect: (phase: 'old' | 'new') => void = () => {},
  gate: Promise<void> = Promise.resolve(),
  reject = false,
) {
  const skipTransition = vi.fn();
  const start = vi.fn((update: () => Promise<void>) => {
    inspect('old');
    const finished = (async () => {
      await update();
      inspect('new');
      await gate;
      if (reject) throw new Error('transition rejected');
    })();
    return { finished, skipTransition };
  });
  Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });
  return { start, skipTransition };
}

describe('workspace view-mode transition orchestration', () => {
  beforeEach(() => cancelWorkspaceViewModeTransition(document));

  afterEach(() => {
    cancelWorkspaceViewModeTransition(document);
    Reflect.deleteProperty(document, 'startViewTransition');
    vi.restoreAllMocks();
  });

  it('generates collision-free stable names for punctuation-heavy workspace IDs', () => {
    const ids = ['a:b', 'a/b', 'a-b', 'a_b', ''];
    expect(new Set(ids.map(getWorkspaceViewTransitionName)).size).toBe(ids.length);
    expect(new Set(ids.map(getWorkspaceContentViewTransitionName)).size).toBe(ids.length);
  });

  it.each([
    { from: 'single' as const, to: 'columns' as const, ids: ['ws-1'], active: 'ws-1' },
    { from: 'single' as const, to: 'columns' as const, ids: ['ws-3', 'ws-1'], active: 'ws-1' },
    {
      from: 'columns' as const,
      to: 'single' as const,
      ids: ['ws-3', 'ws-1', 'ws-2', 'ws-4'],
      active: 'ws-2',
    },
  ])('anchors $from → $to to the active workspace without changing order', async (scenario) => {
    const state = createStore(scenario.from, scenario.active);
    renderMode(scenario.from, scenario.ids, scenario.active);
    const transition = installViewTransition();

    await setWorkspaceViewModeWithTransition(scenario.to, {
      store: state.store,
      afterUpdate: async () => void renderMode(scenario.to, scenario.ids, scenario.active),
    });

    expect(state.dispatch).toHaveBeenCalledTimes(1);
    expect(transition.start).not.toHaveBeenCalled();
    expect(state.mode).toBe(scenario.to);
    expect(
      [
        ...document.querySelectorAll<HTMLElement>('[data-workspace-tab], [data-workspace-column]'),
      ].map((element) => element.dataset.workspaceTab ?? element.dataset.workspaceColumn),
    ).toEqual(scenario.ids);
    expect(
      findVisibleDestination(scenario.to, scenario.active)?.getBoundingClientRect().width,
    ).toBeGreaterThan(0);
    expect(document.querySelector('[data-workspace-transition-name]')).toBeNull();
    expect(document.documentElement.classList.contains('workspace-view-transition')).toBe(false);
  });

  it('replaces a parked source with a visible destination without snapshotting it', async () => {
    const state = createStore('columns', 'ws-2');
    renderMode('columns', ['ws-1', 'ws-2', 'ws-3'], 'ws-2');
    const parked = document.querySelector<HTMLElement>('[data-workspace-column="ws-2"]')!;
    parked.dataset.workspaceSurfaceState = 'parked';
    parked.querySelector('[data-workspace-transition-content]')?.remove();
    const transition = installViewTransition();

    await setWorkspaceViewModeWithTransition('single', {
      store: state.store,
      afterUpdate: async () => void renderMode('single', ['ws-1', 'ws-2', 'ws-3'], 'ws-2'),
    });

    expect(transition.start).not.toHaveBeenCalled();
    expect(state.mode).toBe('single');
    expect(findVisibleDestination('single', 'ws-2')?.getBoundingClientRect().width).toBeGreaterThan(
      0,
    );
  });

  it.each([
    { name: 'offscreen', targetLeft: 900, expected: 900 },
    { name: 'partially visible', targetLeft: 500, expected: 500 },
    { name: 'fully visible', targetLeft: 200, expected: 0 },
  ])(
    'restores the active $name destination with an instant nearest-edge scroll',
    async ({ targetLeft, expected }) => {
      const state = createStore('single');
      renderMode('single', ['ws-1', 'ws-2', 'ws-3'], 'ws-2', { single: { 'ws-2': 250 } });
      installViewTransition();

      await setWorkspaceViewModeWithTransition('columns', {
        store: state.store,
        afterUpdate: async () =>
          void renderMode('columns', ['ws-1', 'ws-2', 'ws-3'], 'ws-2', {
            columns: { 'ws-2': targetLeft },
          }),
      });

      expect(document.querySelector<HTMLElement>('[data-workspace-columns]')!.scrollLeft).toBe(
        expected,
      );
    },
  );

  it('restores a safe active destination when workspace focus is remounted', async () => {
    const state = createStore('single');
    renderMode('single', ['ws-1', 'ws-2'], 'ws-2');
    document.querySelector<HTMLElement>('[data-workspace-tab="ws-2"] [role="tab"]')!.focus();
    installViewTransition();

    await setWorkspaceViewModeWithTransition('columns', {
      store: state.store,
      afterUpdate: async () => void renderMode('columns', ['ws-1', 'ws-2'], 'ws-2'),
    });

    expect(document.activeElement).toBe(document.querySelector('[data-workspace-column="ws-2"]'));
  });

  it('always swaps immediately without native or fallback animation', async () => {
    const reduced = createStore('single');
    renderMode('single', ['ws-1', 'ws-2'], 'ws-2');
    const { start } = installViewTransition();
    await setWorkspaceViewModeWithTransition('columns', {
      store: reduced.store,
      reducedMotion: true,
      afterUpdate: async () => void renderMode('columns', ['ws-1', 'ws-2'], 'ws-2'),
    });
    expect(start).not.toHaveBeenCalled();

    Reflect.deleteProperty(document, 'startViewTransition');
    const fallback = createStore('single');
    renderMode('single', ['ws-1', 'ws-2'], 'ws-2');
    const animate = vi.fn(() => ({ finished: Promise.resolve() }));
    vi.spyOn(Element.prototype, 'animate').mockImplementation(animate as never);
    await setWorkspaceViewModeWithTransition('columns', {
      store: fallback.store,
      afterUpdate: async () => void renderMode('columns', ['ws-1', 'ws-2'], 'ws-2'),
    });
    expect(animate).not.toHaveBeenCalled();
    expect(fallback.mode).toBe('columns');
    expect(document.documentElement.classList.contains('workspace-view-fallback')).toBe(false);
  });

  it('coalesces rapid toggles, survives rejection, and cleans up cancellation', async () => {
    const state = createStore('single');
    renderMode('single', ['ws-1', 'ws-2'], 'ws-2');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = installViewTransition(() => {}, gate);
    const render = async () => void renderMode(state.mode, ['ws-1', 'ws-2'], 'ws-2');
    const one = toggleWorkspaceViewModeWithTransition({ store: state.store, afterUpdate: render });
    await Promise.resolve();
    const two = toggleWorkspaceViewModeWithTransition({ store: state.store, afterUpdate: render });
    const three = toggleWorkspaceViewModeWithTransition({
      store: state.store,
      afterUpdate: render,
    });
    release();
    await Promise.all([one, two, three]);
    expect(first.start).not.toHaveBeenCalled();
    expect(state.dispatch).toHaveBeenCalledTimes(1);

    const rejected = createStore('single');
    renderMode('single', ['ws-1'], 'ws-1');
    const rejectedTransition = installViewTransition(() => {}, Promise.resolve(), true);
    await expect(
      setWorkspaceViewModeWithTransition('columns', {
        store: rejected.store,
        afterUpdate: async () => void renderMode('columns', ['ws-1'], 'ws-1'),
      }),
    ).resolves.toBeUndefined();
    expect(rejectedTransition.start).not.toHaveBeenCalled();
    expect(rejected.mode).toBe('columns');

    const cancelled = createStore('single');
    renderMode('single', ['ws-1'], 'ws-1');
    const transition = installViewTransition();
    document.documentElement.classList.add(
      'workspace-view-transition',
      'workspace-view-to-columns',
    );
    const stale = document.querySelector<HTMLElement>('main.workspace-main')!;
    stale.dataset.workspaceTransitionName = WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME;
    stale.style.viewTransitionName = WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME;
    const switching = setWorkspaceViewModeWithTransition('columns', {
      store: cancelled.store,
      afterUpdate: async () => void renderMode('columns', ['ws-1'], 'ws-1'),
    });
    await Promise.resolve();
    cancelWorkspaceViewModeTransition(document);
    await switching;
    expect(transition.skipTransition).not.toHaveBeenCalled();
    expect(document.querySelector('[data-workspace-transition-name]')).toBeNull();
    expect(document.documentElement.classList.contains('workspace-view-transition')).toBe(false);
  });

  it('cleans stale transition state when the requested mode is already selected', async () => {
    const state = createStore('single', 'ws-1');
    renderMode('single', ['ws-1'], 'ws-1');
    const stale = document.querySelector<HTMLElement>('main.workspace-main')!;
    stale.dataset.workspaceTransitionName = WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME;
    stale.style.viewTransitionName = WORKSPACE_ACTIVE_VIEW_TRANSITION_NAME;
    document.documentElement.classList.add('workspace-view-transition', 'workspace-view-to-single');

    await setWorkspaceViewModeWithTransition('single', {
      store: state.store,
      documentRef: document,
    });

    expect(state.dispatch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-workspace-transition-name]')).toBeNull();
    expect(document.documentElement.classList.contains('workspace-view-transition')).toBe(false);
    expect(findVisibleDestination('single', 'ws-1')?.getBoundingClientRect().width).toBeGreaterThan(
      0,
    );
  });

  it('keeps unsafe snapshot styling dormant behind the safety gate', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8');
    const action = readFileSync(
      resolve(process.cwd(), 'src/features/workspace/workspace-view-mode-action.ts'),
      'utf8',
    );
    const transitionCss = css.slice(
      css.indexOf('html.workspace-view-transition::view-transition-group(*)'),
      css.indexOf('\nhtml,\nbody'),
    );
    expect(css).toContain('::view-transition-old(root)');
    expect(css).toContain('display: none');
    expect(css).toContain('@keyframes workspace-content-reveal');
    expect(action).toContain('workspace-content-reveal 90ms');
    expect(action).toContain('const WORKSPACE_VIEW_TRANSITION_SNAPSHOTS_SAFE = false');
    expect(css).toContain('translateX(8px)');
    expect(transitionCss).toContain('height: 100%');
    expect(transitionCss).toContain('object-fit: none');
    expect(transitionCss).toContain('object-position: left top');
    expect(transitionCss).toContain('overflow: clip');
    expect(transitionCss).not.toContain('overflow: visible');
    expect(transitionCss).not.toMatch(/scale(?:X|Y)?\s*\(/);
    expect(css).not.toContain('[data-workspace-column] > [data-workspace-transition-chrome]');
    expect(action).toContain(
      "return documentRef.querySelector<HTMLElement>('main.workspace-main')",
    );
    expect(action).toContain('section[data-workspace-column][data-workspace-transition-chrome]');
    expect(action).toContain("'[data-workspace-column][data-workspace-transition-chrome]'");
    expect(css).not.toContain('workspace-view-old-fade');
  });
});
