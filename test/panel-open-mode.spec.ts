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
    cacheDir: process.env.PANEL_COLUMNS_VITE_CACHE_DIR,
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

test('walks fixed column counts from one through four and recovers removed content', async ({
  page,
}) => {
  await page.goto(`${baseUrl}src/app.html`);
  const result = await page.evaluate(async () => {
    const layout = await import('/src/store/renderer/slices/panel-layout/panel-layout-slice.ts');
    const preferences =
      await import('/src/store/renderer/slices/user-preferences/user-preferences-slice.ts');
    let state = {
      byWorkspaceId: {
        ws: {
          ...layout.emptyWorkspaceState,
          root: { type: 'panel' as const, panelId: 'p1' },
          panels: {
            p1: {
              id: 'p1',
              tabs: [{ id: 'tab-1', type: 'note' as const, title: 'One', noteId: 'one' }],
              activeTabId: 'tab-1',
            },
          },
          focusedPanelId: 'p1',
        },
      },
    };
    const panelIds = () => {
      const root = state.byWorkspaceId.ws.root;
      return root.type === 'panel'
        ? [root.panelId]
        : root.children.map((child) => (child.type === 'panel' ? child.panelId : ''));
    };
    const counts: number[] = [];

    for (const count of [1, 2, 3, 4] as const) {
      state = layout.panelLayoutReducer(
        state,
        layout.reconcilePanelColumnCount('ws', count, count),
      );
      counts.push(panelIds().length);
      if (count > 1) {
        state = layout.panelLayoutReducer(
          state,
          layout.openTabInRightmostColumn(
            'ws',
            { type: 'note', title: `Note ${count}`, noteId: `note-${count}` },
            { force: true, newTabId: `tab-${count}` },
            count,
          ),
        );
      }
    }
    for (const count of [3, 2, 1] as const) {
      state = layout.panelLayoutReducer(
        state,
        layout.reconcilePanelColumnCount('ws', count, 10 + count),
      );
      counts.push(panelIds().length);
    }
    const preference = preferences.userPreferencesReducer(
      preferences.initialState,
      preferences.setPanelColumnCount(4),
    );
    return {
      counts,
      preference: preference.panelColumnCount,
      panelIds: panelIds(),
      tabs: state.byWorkspaceId.ws.panels.p1.tabs.map((tab) => tab.id),
      activeTabId: state.byWorkspaceId.ws.panels.p1.activeTabId,
    };
  });

  expect(result).toEqual({
    counts: [1, 2, 3, 4, 3, 2, 1],
    preference: 4,
    panelIds: ['p1'],
    tabs: ['tab-1', 'tab-2', 'tab-3', 'tab-4'],
    activeTabId: 'tab-1',
  });
});

test('opens new content in the configured rightmost column', async ({ page }) => {
  await page.goto(`${baseUrl}src/app.html`);
  const result = await page.evaluate(async () => {
    const layout = await import('/src/store/renderer/slices/panel-layout/panel-layout-slice.ts');
    let state = layout.panelLayoutReducer(
      undefined,
      layout.initializeLayout('ws', {
        root: { type: 'panel', panelId: 'left' },
        panels: {
          left: {
            id: 'left',
            tabs: [{ id: 'left-tab', type: 'note', title: 'Left', noteId: 'left' }],
            activeTabId: 'left-tab',
          },
        },
        focusedPanelId: 'left',
      }),
    );
    state = layout.panelLayoutReducer(state, layout.reconcilePanelColumnCount('ws', 2, 1));
    state = layout.panelLayoutReducer(
      state,
      layout.openTabInRightmostColumn(
        'ws',
        { type: 'note', title: 'Right', noteId: 'right' },
        { force: true, newTabId: 'right-tab' },
        2,
      ),
    );
    const workspace = state.byWorkspaceId.ws;
    const rightPanelId =
      workspace.root.type === 'split' && workspace.root.children[1]?.type === 'panel'
        ? workspace.root.children[1].panelId
        : '';
    return {
      focusedPanelId: workspace.focusedPanelId,
      leftTabs: workspace.panels.left.tabs.map((tab) => tab.id),
      rightPanelId,
      rightTabs: workspace.panels[rightPanelId]?.tabs.map((tab) => tab.id),
    };
  });

  expect(result.focusedPanelId).toBe(result.rightPanelId);
  expect(result.leftTabs).toEqual(['left-tab']);
  expect(result.rightTabs).toEqual(['right-tab']);
});
