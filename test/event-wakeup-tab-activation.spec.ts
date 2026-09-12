import { expect, test, type Page } from '@playwright/test';

import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer;
let baseUrl = process.env.PANEL_LIVE_BASE_URL?.replace(/\/$/, '') ?? '';

test.beforeAll(async () => {
  if (baseUrl) return;
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('event-wakeup-tab-activation'),
    plugins: [svelte({ configFile: resolve('svelte.config.js') })],
    optimizeDeps: {
      entries: [
        'src/features/layout/tab-types/AgentTabType.svelte',
        'src/store/renderer/slices/panel-layout/sagas/panel-layout-saga.ts',
        'test/fixtures/RootLifecyclePanelHost.svelte',
      ],
    },
    resolve: {
      alias: [
        { find: '$lib', replacement: resolve('src/lib') },
        { find: '$store', replacement: resolve('src/store') },
        { find: '$features', replacement: resolve('src/features') },
        { find: '$shared', replacement: resolve('src/shared') },
        { find: '$app', replacement: resolve('playwright/app-stubs') },
        {
          find: /^@fortawesome\/free-(?:solid|regular|brands)-svg-icons$/,
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
  baseUrl = server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

async function mountWakeupLayout(page: Page, width: number) {
  await page.goto(`${baseUrl}/src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}/src/app.css` });
  await page.evaluate(async (containerWidth) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    const timestamp = '2026-08-13T16:45:00.000Z';
    const eventMessage = {
      id: 'event-message',
      role: 'user' as const,
      content: '[WORKSPACE EVENTS] Agent finished',
      timestamp,
      metadata: {
        type: 'event_notification' as const,
        eventCount: 1,
        eventTypes: ['agent:idle'],
        events: [
          {
            type: 'agent:idle',
            timestamp,
            data: { agentId: 'agent-wakeup-target', agentName: 'Wakeup target' },
          },
        ],
      },
    };
    let listenerId = 0;
    window.electronAPI = {
      invoke: async (
        channel: string,
        payload?: { method?: string; params?: { agentId?: string } },
      ) => {
        if (channel === 'backend:request') {
          if (payload?.method === 'agent.getQueue') {
            return { ok: true, result: { queue: [] } };
          }
          if (payload?.method === 'agent.getConversation') {
            const messages = payload.params?.agentId === 'agent-source' ? [eventMessage] : [];
            return {
              ok: true,
              result: {
                messages,
                truncated: false,
                totalMessages: messages.length,
                nextToken: null,
                prevToken: null,
              },
            };
          }
          return { ok: true, result: {} };
        }
        if (channel === 'backend:subscribe') {
          return { ok: true, result: { subscriptionId: 'geometry-test' } };
        }
        if (channel === 'backend:unsubscribe') return { ok: true, result: {} };
        return undefined;
      },
      send: () => {},
      on: () => `geometry-listener-${++listenerId}`,
      off: () => {},
      offById: () => {},
      removeAllListeners: () => {},
      devInstance: null,
      devPort: null,
    };
    const actionOrder: string[] = [];
    (window as typeof window & { __eventActionOrder?: string[] }).__eventActionOrder = actionOrder;
    const [
      { mount, tick },
      { store },
      { appLayoutNavigationSaga },
      { watchRightmostColumnRequests },
      { tabTypeRegistry },
      { faBell },
      { default: AgentTabType },
      workspaceActions,
      agentSessionActions,
      { default: PanelSiblingTab },
      { default: RootLifecyclePanelHost },
    ] = await Promise.all([
      import('/@id/svelte'),
      import('/src/store/renderer/store.ts'),
      import('/src/store/renderer/slices/app-layout/sagas/app-layout-navigation-saga.ts'),
      import('/src/store/renderer/slices/panel-layout/sagas/panel-layout-saga.ts'),
      import('/src/features/layout/tab-types/registry.ts'),
      import('/@id/@fortawesome/free-solid-svg-icons'),
      import('/src/features/layout/tab-types/AgentTabType.svelte'),
      import('/src/store/renderer/slices/workspace/workspace-slice.ts'),
      import('/src/store/renderer/slices/agent-session/agent-session-slice.ts'),
      import('/test/fixtures/PanelSiblingTab.svelte'),
      import('/test/fixtures/RootLifecyclePanelHost.svelte'),
    ]);
    store.addMiddleware(() => (next) => (action) => {
      if (/^(appLayout|panelLayout|workspaceAgents|multiPanelContext)\//.test(action.type)) {
        actionOrder.push(action.type);
      }
      return next(action);
    });
    tabTypeRegistry.register({
      type: 'file',
      component: PanelSiblingTab,
      icon: faBell,
      defaultTitle: 'file',
      categoryLabel: 'file',
    });
    tabTypeRegistry.register({
      type: 'agent',
      component: AgentTabType,
      icon: faBell,
      defaultTitle: 'Agent',
      categoryLabel: 'Agent',
    });
    const workspaceId = 'event-wakeup-layout';
    const layout = {
      root: {
        type: 'split' as const,
        direction: 'horizontal' as const,
        children: [
          { type: 'panel' as const, panelId: 'source' },
          { type: 'panel' as const, panelId: 'sibling' },
        ],
        sizes: [50, 50],
      },
      panels: {
        source: {
          id: 'source',
          tabs: [
            {
              id: 'agent-source',
              type: 'agent',
              title: 'Source agent',
              workspaceId,
              agentId: 'agent-source',
              closable: true,
            },
          ],
          activeTabId: 'agent-source',
        },
        sibling: {
          id: 'sibling',
          tabs: [
            {
              id: 'sibling-file',
              type: 'file',
              title: 'Sibling',
              workspaceId,
              filePath: '/tmp/sibling.ts',
              closable: true,
            },
          ],
          activeTabId: 'sibling-file',
        },
      },
      focusedPanelId: 'source',
      canvasWidth: 960,
      columnCount: 2 as const,
      columnCountInitialized: true,
    };
    document.body.replaceChildren();
    const target = document.createElement('div');
    target.style.cssText = `width: ${containerWidth}px; height: 700px; overflow: auto;`;
    document.body.append(target);
    mount(RootLifecyclePanelHost, {
      target,
      props: {
        workspaceId,
        layout,
        hmrData: {},
        startSagas: () => [
          store.runSaga(appLayoutNavigationSaga),
          store.runSaga(watchRightmostColumnRequests),
        ],
        beforeLayoutMount: () => {
          store.dispatch(
            workspaceActions.setWorkspaceEntity({
              id: workspaceId,
              title: 'Event wakeup test',
              status: 'active',
              createdAt: timestamp,
              updatedAt: timestamp,
            }),
          );
          store.dispatch(
            agentSessionActions.bulkUpsertSessions([
              {
                id: 'agent-wakeup-target',
                workspaceId,
                backendSessionId: null,
                name: 'Wakeup target',
                status: 'idle',
                messages: [],
                createdAt: timestamp,
                updatedAt: timestamp,
              },
              {
                id: 'agent-source',
                workspaceId,
                backendSessionId: 'source-session',
                name: 'Source agent',
                status: 'idle',
                messages: [eventMessage],
                createdAt: timestamp,
                updatedAt: timestamp,
              },
            ]),
          );
        },
      },
    });
    await tick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    actionOrder.length = 0;
  }, width);
  await expect(
    page.locator('[data-panel-id="source"] .tab-content-wrapper:not(.hidden) .event-wakeup-banner'),
  ).toBeVisible();
}

async function captureFirstMountedFrame(page: Page) {
  return page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    const host = document.body.firstElementChild!;
    const sample = () => {
      const workspace = store.state.panelLayout.byWorkspaceId['event-wakeup-layout'];
      const panels = [...document.querySelectorAll<HTMLElement>('[data-panel-id][data-layout-id]')];
      const wrappers = [...document.querySelectorAll<HTMLElement>('.tab-content-wrapper')].map(
        (wrapper) => ({
          display: getComputedStyle(wrapper).display,
          ariaHidden: wrapper.getAttribute('aria-hidden'),
          inert: wrapper.inert,
          hasWakeup: Boolean(wrapper.querySelector('.event-wakeup-banner')),
          retainsFocus: wrapper.contains(document.activeElement),
        }),
      );
      return {
        panelIds: Object.keys(workspace.panels),
        root: workspace.root,
        source: workspace.panels.source,
        sibling: workspace.panels.sibling,
        focusedPanelId: workspace.focusedPanelId,
        rects: panels.map((panel) => {
          const rect = panel.getBoundingClientRect();
          return {
            id: panel.dataset.panelId!,
            left: rect.left,
            right: rect.right,
            width: rect.width,
          };
        }),
        wrappers,
        activeElementInInactiveWrapper: wrappers.some(
          (wrapper) => wrapper.ariaHidden === 'true' && wrapper.retainsFocus,
        ),
        actionOrder: [
          ...((window as typeof window & { __eventActionOrder?: string[] }).__eventActionOrder ??
            []),
        ],
      };
    };
    return new Promise<ReturnType<typeof sample>>((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Wake target did not mount: ${JSON.stringify(sample())}`));
      }, 10_000);
      const observer = new MutationObserver(() => {
        const panels = store.state.panelLayout.byWorkspaceId['event-wakeup-layout']?.panels;
        const targetTab = Object.values(panels ?? {})
          .flatMap((panel) => panel.tabs)
          .find((tab) => tab.type === 'agent' && tab.agentId === 'agent-wakeup-target');
        const wrappers = [...document.querySelectorAll<HTMLElement>('.tab-content-wrapper')];
        const targetMounted = wrappers.some(
          (wrapper) =>
            wrapper.dataset.tabId === targetTab?.id && !wrapper.classList.contains('hidden'),
        );
        if (!targetMounted) return;
        observer.disconnect();
        clearTimeout(timeout);
        requestAnimationFrame(() => resolve(sample()));
      });
      observer.observe(host, { attributes: true, childList: true, subtree: true });
      Object.assign(window, { __wakeupFrameObserverReady: true });
    });
  });
}

test.describe('EventWakeupBanner panel navigation geometry', () => {
  for (const width of [1400, 760]) {
    test(`first wake target opens in the rightmost panel at ${width}px`, async ({ page }) => {
      await mountWakeupLayout(page, width);
      const firstFramePromise = captureFirstMountedFrame(page);
      await page.waitForFunction(
        () =>
          (window as Window & { __wakeupFrameObserverReady?: boolean }).__wakeupFrameObserverReady,
      );
      await page
        .locator('[data-panel-id="source"] .event-wakeup-banner')
        .getByRole('button', { name: /^Open agent Wakeup target$/ })
        .click();
      const frame = await firstFramePromise;
      const target = frame.sibling.tabs.find(
        (tab: { agentId?: string }) => tab.agentId === 'agent-wakeup-target',
      );

      expect(frame.panelIds).toEqual(['source', 'sibling']);
      expect(frame.root).toMatchObject({ type: 'split', direction: 'horizontal' });
      // ba53c575 routes default agent opens to the rightmost fixed column.
      expect(frame.source.tabs).toHaveLength(1);
      expect(frame.source.activeTabId).toBe('agent-source');
      expect(frame.sibling.tabs).toHaveLength(2);
      expect(target).toBeDefined();
      expect(frame.sibling.activeTabId).toBe(target?.id);
      expect(frame.focusedPanelId).toBe('sibling');
      expect(frame.rects[0].right).toBeLessThanOrEqual(frame.rects[1].left);
      expect(frame.activeElementInInactiveWrapper).toBe(false);
      expect(frame.wrappers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hasWakeup: false,
            display: 'none',
            ariaHidden: 'true',
            inert: true,
            retainsFocus: false,
          }),
          expect.objectContaining({ display: 'block', ariaHidden: 'false', inert: false }),
        ]),
      );
      const routingActions = [
        'appLayout/openAgentTabRequested',
        'workspaceAgents/ensureAgentSessionLoaded',
        'panelLayout/openTabInRightmostColumnRequested',
        'panelLayout/reconcilePanelColumnCount',
        'panelLayout/openTabInRightmostColumn',
      ];
      expect(frame.actionOrder.filter((type) => routingActions.includes(type))).toEqual(
        routingActions,
      );
    });
  }
});
