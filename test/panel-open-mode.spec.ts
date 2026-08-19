import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: process.env.PANEL_MODE_VITE_CACHE_DIR,
    plugins: [svelte({ configFile: resolve('svelte.config.js') })],
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve('src/lib') },
        { find: '$store', replacement: resolve('src/store') },
        { find: '$features', replacement: resolve('src/features') },
        { find: '$shared', replacement: resolve('src/shared') },
        { find: '$app', replacement: resolve('playwright/app-stubs') },
        {
          find: '@fortawesome/free-solid-svg-icons',
          replacement: resolve('src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: '@fortawesome/fontawesome-svg-core',
          replacement: resolve('src/lib/icons/phosphor-icons.ts'),
        },
        { find: 'svelte-fa', replacement: resolve('src/lib/components/shared/icons/fa-proxy.ts') },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

test('keeps one reusable left panel across wide, narrow, and reduced-motion cases', async ({
  page,
}) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const width of [1440, 720]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${baseUrl}src/app.html`);
      const result = await page.evaluate(async () => {
        const layout =
          await import('/src/store/renderer/slices/panel-layout/panel-layout-slice.ts');
        const preferences =
          await import('/src/store/renderer/slices/user-preferences/user-preferences-slice.ts');
        const panel = (id: string, tabId: string, pinned = false) => ({
          id,
          tabs: [{ id: tabId, type: 'note', title: tabId, noteId: tabId, closable: true }],
          activeTabId: tabId,
          pinned,
        });
        let state = {
          byWorkspaceId: {
            ws: {
              ...layout.emptyWorkspaceState,
              root: {
                type: 'split' as const,
                direction: 'horizontal' as const,
                children: [
                  { type: 'panel' as const, panelId: 'pinned' },
                  { type: 'panel' as const, panelId: 'active' },
                  { type: 'panel' as const, panelId: 'other' },
                ],
                sizes: [30, 40, 30],
              },
              panels: {
                pinned: panel('pinned', 'keep', true),
                active: panel('active', 'active-old'),
                other: panel('other', 'close-me'),
              },
              focusedPanelId: 'active',
            },
          },
        };
        const pinPreference = preferences.userPreferencesReducer(
          preferences.initialState,
          preferences.setPanelOpenMode('pin'),
        );
        localStorage.setItem('panel-layout:openMode', JSON.stringify(pinPreference.panelOpenMode));
        state = layout.panelLayoutReducer(
          state,
          layout.openTabInNewRootColumn(
            'ws',
            { type: 'note', title: 'First', noteId: 'first', closable: true },
            { panelOpenMode: pinPreference.panelOpenMode, force: true },
            1,
          ),
        );
        const first = state.byWorkspaceId.ws;
        state = layout.panelLayoutReducer(
          state,
          layout.openTabInNewRootColumn(
            'ws',
            { type: 'note', title: 'Second', noteId: 'second', closable: true },
            { panelOpenMode: pinPreference.panelOpenMode, force: true },
            2,
          ),
        );
        const second = state.byWorkspaceId.ws;
        const order = (node: typeof second.root): string[] =>
          node.type === 'panel' ? [node.panelId] : node.children.flatMap(order);
        return {
          storedMode: JSON.parse(localStorage.getItem('panel-layout:openMode') ?? 'null'),
          firstPanels: Object.keys(first.panels),
          secondPanels: Object.keys(second.panels),
          order: order(second.root),
          activeTabs: second.panels.active.tabs.map((tab) => tab.noteId),
          pinnedTabs: second.panels.pinned.tabs.map((tab) => tab.noteId),
          recentlyClosed: second.recentlyClosed.map((entry) => entry.tab.noteId),
          reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        };
      });
      expect(result).toMatchObject({
        storedMode: 'pin',
        firstPanels: ['pinned', 'active'],
        secondPanels: ['pinned', 'active'],
        order: ['active', 'pinned'],
        activeTabs: ['second'],
        pinnedTabs: ['keep'],
        reducedMotion: reducedMotion === 'reduce',
      });
      expect(result.recentlyClosed).toEqual(
        expect.arrayContaining(['active-old', 'close-me', 'first']),
      );
    }
  }
});

test('preserves columns when returning to normal mode and toggles from the keyboard', async ({
  page,
}) => {
  await page.goto(`${baseUrl}src/app.html`);
  const result = await page.evaluate(async () => {
    const layout = await import('/src/store/renderer/slices/panel-layout/panel-layout-slice.ts');
    const preferences =
      await import('/src/store/renderer/slices/user-preferences/user-preferences-slice.ts');
    let preference = preferences.initialState;
    addEventListener('keydown', (event) => {
      if (event.altKey && event.metaKey && event.key.toLowerCase() === 'p') {
        preference = preferences.userPreferencesReducer(
          preference,
          preferences.togglePanelOpenMode(),
        );
      }
    });
    dispatchEvent(new KeyboardEvent('keydown', { key: 'p', altKey: true, metaKey: true }));
    const keyboardMode = preference.panelOpenMode;
    let state = layout.panelLayoutReducer(
      undefined,
      layout.initializeLayout('one', {
        root: { type: 'panel', panelId: 'one-a' },
        panels: { 'one-a': { id: 'one-a', tabs: [], activeTabId: null, pinned: true } },
        focusedPanelId: 'one-a',
      }),
    );
    state = layout.panelLayoutReducer(
      state,
      layout.openTabInNewRootColumn(
        'one',
        { type: 'note', title: 'Pinned mode', noteId: 'pin', closable: true },
        { panelOpenMode: preference.panelOpenMode, force: true },
        1,
      ),
    );
    const beforeNormal = JSON.stringify(state.byWorkspaceId.one.root);
    preference = preferences.userPreferencesReducer(
      preference,
      preferences.setPanelOpenMode('normal'),
    );
    const afterToggle = JSON.stringify(state.byWorkspaceId.one.root);
    state = layout.panelLayoutReducer(
      state,
      layout.openTabInNewRootColumn(
        'one',
        { type: 'note', title: 'Normal mode', noteId: 'normal', closable: true },
        { panelOpenMode: preference.panelOpenMode, force: true },
        2,
      ),
    );
    return {
      keyboardMode,
      finalMode: preference.panelOpenMode,
      preserved: beforeNormal === afterToggle,
      panelCount: Object.keys(state.byWorkspaceId.one.panels).length,
    };
  });
  expect(result).toEqual({
    keyboardMode: 'pin',
    finalMode: 'normal',
    preserved: true,
    panelCount: 3,
  });
});

test('keeps newest pins next to the reusable panel and preserves unpinned width', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const zoom of [1, 2]) {
    await page.goto(`${baseUrl}src/app.html`);
    const result = await page.evaluate(async (zoomFactor) => {
      document.documentElement.style.zoom = String(zoomFactor);
      const layout = await import('/src/store/renderer/slices/panel-layout/panel-layout-slice.ts');
      const panel = (id: string, tabId: string, pinned: boolean) => ({
        id,
        tabs: [{ id: tabId, type: 'note' as const, title: tabId, noteId: tabId, closable: true }],
        activeTabId: tabId,
        pinned,
      });
      let state = {
        byWorkspaceId: {
          ws: {
            ...layout.emptyWorkspaceState,
            root: {
              type: 'split' as const,
              direction: 'horizontal' as const,
              children: [
                { type: 'panel' as const, panelId: 'reusable' },
                { type: 'panel' as const, panelId: 'older' },
              ],
              sizes: [60, 40],
            },
            panels: {
              reusable: panel('reusable', 'reusable-tab', false),
              older: panel('older', 'older-tab', true),
            },
            focusedPanelId: 'reusable',
            canvasWidth: 1000,
            canvasWidthSource: 'explicit' as const,
          },
        },
      };
      state = layout.panelLayoutReducer(state, layout.setPanelPinned('ws', 'reusable', true, 1));
      state = layout.panelLayoutReducer(
        state,
        layout.openTabInNewRootColumn(
          'ws',
          { type: 'note', title: 'Next', noteId: 'next', closable: true },
          { panelOpenMode: 'pin', force: true, newTabId: 'next-tab' },
          2,
        ),
      );
      const afterPin = state.byWorkspaceId.ws;
      const order = (node: typeof afterPin.root): string[] =>
        node.type === 'panel' ? [node.panelId] : node.children.flatMap(order);
      const sizing = await import('/src/shared/panel-layout-sizing.ts');
      const panelWidth = (workspace: typeof afterPin, panelId: string) => {
        if (workspace.root.type !== 'split' || workspace.root.direction !== 'horizontal') return 0;
        const index = workspace.root.children.findIndex(
          (child) => child.type === 'panel' && child.panelId === panelId,
        );
        const usableWidth =
          (workspace.canvasWidth ?? 0) -
          sizing.PANEL_SPLIT_GUTTER_WIDTH * (workspace.root.children.length - 1);
        return usableWidth * ((workspace.root.sizes[index] ?? 0) / 100);
      };
      const pinnedOrder = order(afterPin.root);
      const targetWidthBeforeUnpin = panelWidth(afterPin, 'older');
      state = layout.panelLayoutReducer(state, layout.setPanelPinned('ws', 'older', false, 3));
      const afterUnpin = state.byWorkspaceId.ws;
      return {
        zoom: getComputedStyle(document.documentElement).zoom,
        pinnedOrder,
        unpinnedOrder: order(afterUnpin.root),
        panels: Object.keys(afterUnpin.panels),
        focus: afterUnpin.focusedPanelId,
        targetTab: afterUnpin.panels.older.activeTabId,
        targetWidthDelta: Math.abs(panelWidth(afterUnpin, 'older') - targetWidthBeforeUnpin),
      };
    }, zoom);

    expect(result).toEqual({
      zoom: String(zoom),
      pinnedOrder: [expect.stringMatching(/^panel-/), 'reusable', 'older'],
      unpinnedOrder: ['older', 'reusable'],
      panels: ['reusable', 'older'],
      focus: 'older',
      targetTab: 'older-tab',
      targetWidthDelta: expect.closeTo(0, 6),
    });
  }
});
