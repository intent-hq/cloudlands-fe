import { expect, test, type Page } from '@playwright/test';

const baseUrl = process.env.PANEL_LIVE_BASE_URL ?? 'http://127.0.0.1:5191';

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
      invoke: async (channel: string, payload?: { method?: string }) => {
        if (channel === 'backend:request') {
          if (payload?.method === 'agent.getQueue') {
            return { ok: true, result: { queue: [] } };
          }
          if (payload?.method === 'agent.getConversation') {
            return {
              ok: true,
              result: {
                messages: [eventMessage],
                truncated: false,
                totalMessages: 1,
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
    const originalGroup = console.groupCollapsed;
    console.groupCollapsed = (...args) => {
      const title = String(args[0]).replace('%c', '');
      if (/^(appLayout|panelLayout|workspaceAgents|multiPanelContext)\//.test(title)) {
        actionOrder.push(title.split(' ')[0]);
      }
      originalGroup(...args);
    };
    (window as typeof window & { __eventActionOrder?: string[] }).__eventActionOrder = actionOrder;
    const [
      { mount, tick },
      { store },
      { appLayoutNavigationSaga },
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
      import('/src/features/layout/tab-types/registry.ts'),
      import('/@id/@fortawesome/free-solid-svg-icons'),
      import('/src/features/layout/tab-types/AgentTabType.svelte'),
      import('/src/store/renderer/slices/workspace/workspace-slice.ts'),
      import('/src/store/renderer/slices/agent-session/agent-session-slice.ts'),
      import('/test/fixtures/PanelSiblingTab.svelte'),
      import('/test/fixtures/RootLifecyclePanelHost.svelte'),
    ]);
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
        startSagas: () => [store.runSaga(appLayoutNavigationSaga)],
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
      const source = document.querySelector<HTMLElement>('[data-panel-id="source"]')!;
      const wrappers = [...source.querySelectorAll<HTMLElement>('.tab-content-wrapper')].map(
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
    return new Promise<ReturnType<typeof sample>>((resolve) => {
      const observer = new MutationObserver(() => {
        const source = store.state.panelLayout.byWorkspaceId['event-wakeup-layout']?.panels.source;
        const wrappers = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-panel-id="source"] .tab-content-wrapper',
          ),
        ];
        const targetMounted = wrappers.some(
          (wrapper) =>
            !wrapper.classList.contains('hidden') && !wrapper.querySelector('.event-wakeup-banner'),
        );
        if (source?.tabs.length !== 2 || wrappers.length !== 2 || !targetMounted) return;
        observer.disconnect();
        requestAnimationFrame(() => resolve(sample()));
      });
      observer.observe(host, { attributes: true, childList: true, subtree: true });
    });
  });
}

test.describe('EventWakeupBanner panel navigation geometry', () => {
  for (const width of [1400, 760]) {
    test(`first wake target stays mounted in the source panel at ${width}px`, async ({ page }) => {
      await mountWakeupLayout(page, width);
      const firstFramePromise = captureFirstMountedFrame(page);
      await page
        .locator('[data-panel-id="source"] .event-wakeup-banner')
        .getByRole('button', { name: /^Wakeup target/ })
        .click();
      const frame = await firstFramePromise;
      const target = frame.source.tabs.find(
        (tab: { agentId?: string }) => tab.agentId === 'agent-wakeup-target',
      );

      expect(frame.panelIds).toEqual(['source', 'sibling']);
      expect(frame.root).toMatchObject({ type: 'split', direction: 'horizontal' });
      expect(frame.source.tabs).toHaveLength(2);
      expect(frame.source.activeTabId).toBe(target?.id);
      expect(frame.sibling.activeTabId).toBe('sibling-file');
      expect(frame.focusedPanelId).toBe('source');
      expect(frame.rects[0].right).toBeLessThanOrEqual(frame.rects[1].left);
      expect(frame.activeElementInInactiveWrapper).toBe(false);
      expect(frame.wrappers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            hasWakeup: true,
            display: 'none',
            ariaHidden: 'true',
            inert: true,
            retainsFocus: false,
          }),
          expect.objectContaining({ display: 'block', ariaHidden: 'false', inert: false }),
        ]),
      );
      expect(frame.actionOrder.filter((type) => type !== 'panelLayout/focusPanel')).toEqual([
        'workspaceAgents/ensureAgentSessionLoaded',
        'panelLayout/openTab',
        'appLayout/openAgentTabRequested',
        'multiPanelContext/setWorkspace',
        'multiPanelContext/updatePanels',
      ]);
    });
  }
});
