import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';

let server: ViteDevServer;
let baseUrl = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir: viteHarnessCacheDir('titlebar-workspace-controls'),
    optimizeDeps: { include: ['bits-ui', 'svelte', 'flatstr', 'redux-saga', 'typed-redux-saga'] },
    plugins: [svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
    resolve: {
      alias: [
        {
          find: '$lib/components/chat/ChatPanel.svelte',
          replacement: resolve(
            process.cwd(),
            'src/lib/components/layout/sidebar-nav/__tests__/mocks/MockChiefChatPanel.svelte',
          ),
        },
        { find: '$lib', replacement: resolve(process.cwd(), 'src/lib') },
        { find: '$store', replacement: resolve(process.cwd(), 'src/store') },
        { find: '$features', replacement: resolve(process.cwd(), 'src/features') },
        { find: '$shared', replacement: resolve(process.cwd(), 'src/shared') },
        {
          find: /^\$app\/(state|navigation)$/,
          replacement: resolve(process.cwd(), 'test/fixtures/titlebar-navigation.svelte.ts'),
        },
        { find: '$app', replacement: resolve(process.cwd(), 'playwright/app-stubs') },
        {
          find: /^@fortawesome\/(?:fontawesome-common-types|fontawesome-svg-core|free-brands-svg-icons|free-regular-svg-icons|free-solid-svg-icons)$/,
          replacement: resolve(process.cwd(), 'src/lib/icons/phosphor-icons.ts'),
        },
        {
          find: /^svelte-fa$/,
          replacement: resolve(process.cwd(), 'src/lib/components/shared/icons/fa-proxy.ts'),
        },
      ],
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

async function mountControls(
  page: Page,
  theme: 'light' | 'dark',
  zoom: number,
  withAssistant = false,
) {
  await page.goto(baseUrl + 'test/fixtures/titlebar-controls.html');
  await page.addStyleTag({ url: baseUrl + 'src/app.css' });
  await page.evaluate(
    async ({ theme, zoom, withAssistant }) => {
      Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
      const [{ mount, tick }, { default: Harness }] = await Promise.all([
        import('/@id/svelte'),
        import('/test/fixtures/TitlebarWorkspaceControlsHarness.svelte'),
      ]);
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.body.replaceChildren();
      const target = document.createElement('div');
      document.body.append(target);
      const listeners = new Map<string, EventListener>();
      Object.assign(window, {
        electronAPI: {
          invoke: async (channel: string, params: unknown) => {
            if (channel !== 'window:get-zoom-factor' || params !== undefined) {
              throw new Error('Unexpected titlebar IPC request');
            }
            return { success: true, data: zoom };
          },
          on: (channel: string, handler: (payload: unknown) => void) => {
            const listener = (event: Event) => handler((event as CustomEvent).detail);
            listeners.set(channel, listener);
            window.addEventListener(channel, listener);
            return channel;
          },
          offById: (channel: string) => {
            const listener = listeners.get(channel);
            if (listener) window.removeEventListener(channel, listener);
          },
        },
      });
      document.body.style.zoom = String(zoom);
      mount(Harness, { target, props: { withAssistant } });
      const { store } = await import('/src/store/renderer/store.ts');
      const { zoomIpcSaga } =
        await import('/src/store/renderer/slices/user-preferences/sagas/zoom-ipc-saga.ts');
      store.runSaga(zoomIpcSaga);
      await tick();
    },
    { theme, zoom, withAssistant },
  );
}

async function emulatePlatform(page: Page, platform: 'macOS' | 'Windows' | 'Linux') {
  await page.addInitScript((platform) => {
    Object.defineProperty(navigator, 'userAgentData', { value: { platform } });
    Object.defineProperty(navigator, 'userAgent', {
      value: platform === 'macOS' ? 'Macintosh' : platform,
    });
  }, platform);
}

// Browser page scaling models Electron zoom; deliver its existing IPC payload
// through the real saga. Native menu delivery is covered by the main IPC suite.
async function changeZoom(page: Page, zoom: number) {
  await page.evaluate((zoom) => {
    document.body.style.zoom = String(zoom);
    window.dispatchEvent(new CustomEvent('window:zoom-changed', { detail: { zoomFactor: zoom } }));
  }, zoom);
}

test('keeps the Mac Home hit target clear of traffic lights through live zoom and reset', async ({
  page,
}) => {
  await emulatePlatform(page, 'macOS');
  await mountControls(page, 'dark', 1);
  const toggle = page.locator('[data-titlebar-spaces-control]');
  const wrapper = page.locator('.window-title-bar-wrapper');
  const homeTab = page.locator('[data-home-tab]');
  const initialLeft = (await homeTab.boundingBox())!.x;
  // Independent safe-area requirement, not derived from the production padding.
  expect(initialLeft).toBeGreaterThanOrEqual(88);
  for (const zoom of [0.8, 0.67, 0.5, 1, 1.25, 2, 1]) {
    await changeZoom(page, zoom);
    // Measure the outer tab: Chromium rounds its 1px border at fractional zoom.
    await expect.poll(async () => (await homeTab.boundingBox())!.x).toBeCloseTo(initialLeft, 0);
    expect((await toggle.boundingBox())!.x).toBeGreaterThanOrEqual(88);
    await expect.poll(async () => (await wrapper.boundingBox())!.height).toBeCloseTo(35, 0);
    const box = (await toggle.boundingBox())!;
    // Home uses a 48px tab with the standard 32px control height.
    expect(box.width).toBeCloseTo(48, 0);
    expect(box.height).toBeCloseTo(32, 0);
    for (const activation of ['click', 'Enter', 'Space']) {
      await page.evaluate(async () => {
        const { goto, page } = await import('/test/fixtures/titlebar-navigation.svelte.ts');
        await goto('/workspace/titlebar-test');
        if (page.url.pathname !== '/workspace/titlebar-test')
          throw new Error('Route did not reset');
      });
      await expect(toggle).not.toHaveAttribute('aria-current');
      if (activation === 'click') await toggle.click();
      else await toggle.press(activation);
      await expect(toggle).toHaveAttribute('aria-current', 'page');
    }
  }
});

for (const platform of ['Windows', 'Linux'] as const) {
  test(`${platform} retains its existing Home placement`, async ({ page }) => {
    await emulatePlatform(page, platform);
    await mountControls(page, 'light', 1);
    const homeTab = page.locator('[data-home-tab]');
    for (const zoom of [1, 0.5, 2, 1]) {
      await changeZoom(page, zoom);
      await expect.poll(async () => (await homeTab.boundingBox())!.x).toBeCloseTo(28, 0);
    }
  });
}

test('Mac Home navigation ignores the retired sidebar and keeps narrow-window controls usable', async ({
  page,
}, testInfo) => {
  await emulatePlatform(page, 'macOS');
  await page.setViewportSize({ width: 640, height: 480 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountControls(page, 'light', 0.67);
  const toggle = page.locator('[data-titlebar-spaces-control]');
  const tabs = page.locator('[data-titlebar-workspace-controls]');
  const initialLeft = (await tabs.boundingBox())!.x;
  await page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    const { sidebarNavSaga } =
      await import('/src/store/renderer/slices/sidebar-nav/sagas/sidebar-nav-saga.ts');
    localStorage.setItem('intent:sidebar-panel-item', JSON.stringify('all-workspaces'));
    localStorage.setItem('intent:sidebar-panel-width', '320');
    localStorage.setItem('intent:sidebar-card-pinned', 'true');
    localStorage.setItem('intent:pinned-workspaces', JSON.stringify(['titlebar-test']));
    store.runSaga(sidebarNavSaga);
  });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const { store } = await import('/src/store/renderer/store.ts');
        return store.state.sidebarNav.pinnedWorkspaceIds;
      }),
    )
    .toEqual(['titlebar-test']);
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeCloseTo(initialLeft, 0);
  await page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    const { openPanel } =
      await import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts');
    store.dispatch(openPanel('chief'));
  });
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeCloseTo(initialLeft, 0);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-current', 'page');
  expect(
    await page.evaluate(async () => {
      const { store } = await import('/src/store/renderer/store.ts');
      return store.state.sidebarNav.panelItem;
    }),
  ).toBe('chief');
  const toggleBox = (await toggle.boundingBox())!;
  await expect.poll(async () => (await tabs.boundingBox())!.x).toBeLessThan(200);

  for (const selector of ['[data-titlebar-left-drag-handle]', '[data-titlebar-drag-handle]']) {
    const drag = page.locator(selector);
    // Fractional zoom can round an 8px drag surface down by a subpixel.
    expect((await drag.boundingBox())!.width).toBeGreaterThan(7.5);
    expect(
      await drag.evaluate((node) => getComputedStyle(node).getPropertyValue('-webkit-app-region')),
    ).toBe('drag');
  }
  expect(toggleBox.x).toBeGreaterThanOrEqual(88);
  for (const control of [
    toggle,
    page.locator('[data-workspace-repo-launcher] button'),
    page.locator('[data-titlebar-settings]'),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(640);
    expect(
      await control.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return node.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
    ).toBe(true);
    expect(
      await control.evaluate((node) =>
        getComputedStyle(node).getPropertyValue('-webkit-app-region'),
      ),
    ).toBe('no-drag');
  }
  await page.locator('[data-workspace-repo-launcher] button').click();
  expect(
    await page.evaluate(async () => {
      const { store } = await import('/src/store/renderer/store.ts');
      return store.state.sidebarNav.showCreateModal;
    }),
  ).toBe(true);
  await testInfo.attach('homepage-sidebar-upgrade', {
    body: await page.screenshot({ animations: 'disabled', caret: 'hide' }),
    contentType: 'image/png',
  });
});

for (const savedPanel of ['home', 'active', 'chief', 'settings', '{invalid-json']) {
  test(`upgrade ignores saved sidebar destination ${savedPanel}`, async ({ page }, testInfo) => {
    await mountControls(page, 'light', 1);
    await page.evaluate(async (savedPanel) => {
      localStorage.setItem(
        'intent:sidebar-panel-item',
        savedPanel.startsWith('{') ? savedPanel : JSON.stringify(savedPanel),
      );
      localStorage.setItem('intent:sidebar-card-pinned', 'true');
      localStorage.setItem('intent:chief-active-agent-id', JSON.stringify('existing-thread'));
      const [{ store }, { sidebarNavSaga }] = await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/sidebar-nav/sagas/sidebar-nav-saga.ts'),
      ]);
      store.runSaga(sidebarNavSaga);
    }, savedPanel);
    const state = () =>
      page.evaluate(async () => {
        const { store } = await import('/src/store/renderer/store.ts');
        return {
          panelItem: store.state.sidebarNav.panelItem,
          chiefActiveAgentId: store.state.sidebarNav.chiefActiveAgentId,
        };
      });
    await expect.poll(state).toEqual({ panelItem: null, chiefActiveAgentId: 'existing-thread' });
    const home = page.locator('[data-titlebar-spaces-control]');
    await home.click();
    await expect(home).toHaveAttribute('aria-current', 'page');
    await page.evaluate(async () => {
      const { goto } = await import('/test/fixtures/titlebar-navigation.svelte.ts');
      await goto('/workspace/titlebar-test');
    });
    await expect(home).not.toHaveAttribute('aria-current');
    expect(await state()).toEqual({ panelItem: null, chiefActiveAgentId: 'existing-thread' });
    await testInfo.attach('upgrade-state', {
      body: JSON.stringify({ savedPanel, state: await state() }),
      contentType: 'application/json',
    });
  });
}

test('Assistant notifications open Home and select the existing thread', async ({
  page,
}, testInfo) => {
  await mountControls(page, 'light', 1);
  await page.evaluate(async () => {
    const { handleNotificationNavigate } =
      await import('/src/features/notifications/notification-navigation.ts');
    await handleNotificationNavigate({
      workspaceId: '__chief__',
      chief: true,
      agentId: 'notification-thread',
    });
  });
  await expect(page.locator('[data-titlebar-spaces-control]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  const state = await page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    return {
      panelItem: store.state.sidebarNav.panelItem,
      chiefActiveAgentId: store.state.sidebarNav.chiefActiveAgentId,
    };
  });
  expect(state).toEqual({ panelItem: 'chief', chiefActiveAgentId: 'notification-thread' });
  await testInfo.attach('assistant-notification-navigation', {
    body: JSON.stringify(state),
    contentType: 'application/json',
  });
});

async function prepareAssistantBoundary(page: Page) {
  await mountControls(page, 'light', 1, true);
  await page.evaluate(async () => {
    const [{ store }, { bulkUpsertSessions }, nav, unread, { unreadTrackingSaga }, { goto }, tabs] =
      await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/agent-session/agent-session-slice.ts'),
        import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts'),
        import('/src/store/renderer/slices/unread-tracking/unread-tracking-slice.ts'),
        import('/src/store/renderer/slices/unread-tracking/sagas/unread-tracking-saga.ts'),
        import('/test/fixtures/titlebar-navigation.svelte.ts'),
        import('/src/store/renderer/slices/tab-state/tab-state-slice.ts'),
      ]);
    const api = window.electronAPI!;
    const invoke = api.invoke;
    const requests: unknown[] = [];
    Object.assign(window, { __assistantSeenRequests: requests });
    api.invoke = async (channel, payload) => {
      if (
        channel === 'backend:request' &&
        (payload as { method?: string })?.method === 'agent.markSeen'
      ) {
        requests.push({ channel, payload });
        return {
          success: true,
          data: { success: true, lastSeenMessageId: 'assistant-message-seen' },
        };
      }
      return invoke(channel, payload);
    };
    store.dispatch(
      bulkUpsertSessions([
        {
          id: 'assistant-route-thread',
          workspaceId: '__chief__',
          name: 'Assistant route boundary',
          status: 'active',
          createdAt: '2026-10-05T12:00:00.000Z',
          updatedAt: '2026-10-05T12:00:00.000Z',
          messages: [
            {
              id: 'assistant-message-seen',
              role: 'assistant',
              content: 'Already viewed',
              timestamp: '2026-10-05T12:00:00.000Z',
            },
          ],
        },
      ] as never),
    );
    store.dispatch(tabs.openWorkspaceTab('titlebar-other'));
    store.dispatch(tabs.openWorkspaceTab('titlebar-test'));
    store.runSaga(unreadTrackingSaga);
    store.dispatch(nav.setChiefActiveAgentId('assistant-route-thread'));
    store.dispatch(nav.openPanel('chief'));
    await goto('/');
    store.dispatch(unread.startDividerSession('assistant-route-thread', 'old-anchor'));
  });
  await expect(page.locator('[data-home-assistant]')).toBeVisible();
  await expect(page.getByTestId('mock-chat-panel')).toContainText('assistant-route-thread');
}

async function assistantBoundaryState(page: Page) {
  return page.evaluate(async () => {
    const { store } = await import('/src/store/renderer/store.ts');
    const { page } = await import('/test/fixtures/titlebar-navigation.svelte.ts');
    return {
      path: page.url.pathname,
      panelItem: store.state.sidebarNav.panelItem,
      selectedThread: store.state.sidebarNav.chiefActiveAgentId,
      divider: store.state.unreadTracking.dividerSessionByAgentId['assistant-route-thread'] ?? null,
      requests: (window as unknown as { __assistantSeenRequests: unknown[] })
        .__assistantSeenRequests,
    };
  });
}

for (const destination of ['current workspace', 'other workspace', 'Settings'] as const) {
  test(`leaving Home Assistant for ${destination} ends its unread session`, async ({
    page,
  }, testInfo) => {
    await prepareAssistantBoundary(page);
    const before = await assistantBoundaryState(page);
    expect(before.divider).toEqual({ anchorId: 'old-anchor' });
    if (destination === 'Settings') await page.locator('[data-titlebar-settings]').click();
    else
      await page
        .locator(
          `[data-workspace-tab="${destination === 'current workspace' ? 'titlebar-test' : 'titlebar-other'}"]`,
        )
        .click();
    await expect(page.locator('[data-home-assistant]')).toHaveCount(0);
    await expect
      .poll(async () => {
        const state = await assistantBoundaryState(page);
        return { panelItem: state.panelItem, divider: state.divider, requests: state.requests };
      })
      .toEqual({
        panelItem: null,
        divider: null,
        requests: [
          {
            channel: 'backend:request',
            payload: {
              method: 'agent.markSeen',
              params: {
                workspaceId: '__chief__',
                agentId: 'assistant-route-thread',
                messageId: 'assistant-message-seen',
              },
            },
          },
        ],
      });
    const away = await assistantBoundaryState(page);
    expect(away.selectedThread).toBe('assistant-route-thread');
    expect(away.path).toBe(
      destination === 'Settings'
        ? '/settings'
        : `/workspace/${destination === 'current workspace' ? 'titlebar-test' : 'titlebar-other'}`,
    );
    await page.evaluate(async () => {
      const [{ store }, { bulkUpsertSessions }, nav, unread, { goto }] = await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/agent-session/agent-session-slice.ts'),
        import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts'),
        import('/src/store/renderer/slices/unread-tracking/unread-tracking-slice.ts'),
        import('/test/fixtures/titlebar-navigation.svelte.ts'),
      ]);
      const session = store.state.agentSessions.byAgentId['assistant-route-thread'];
      store.dispatch(
        bulkUpsertSessions([
          {
            ...session,
            messages: [
              ...session.messages,
              {
                id: 'assistant-message-arrived-away',
                role: 'assistant',
                content: 'Arrived while away',
                timestamp: '2026-10-05T12:01:00.000Z',
              },
            ],
          },
        ] as never),
      );
      store.dispatch(nav.openPanel('chief'));
      await goto('/');
      store.dispatch(
        unread.startDividerSession('assistant-route-thread', 'assistant-message-arrived-away'),
      );
    });
    await expect(page.locator('[data-home-assistant]')).toBeVisible();
    const returned = await assistantBoundaryState(page);
    expect(returned.divider).toEqual({ anchorId: 'assistant-message-arrived-away' });
    expect(returned.selectedThread).toBe('assistant-route-thread');
    await testInfo.attach('assistant-route-boundary', {
      body: JSON.stringify({ destination, before, away, returned }, null, 2),
      contentType: 'application/json',
    });
    await testInfo.attach('assistant-returned', {
      body: await page.screenshot({ animations: 'disabled', caret: 'hide' }),
      contentType: 'image/png',
    });
  });
}

test('one Assistant card unmount does not close another mounted card', async ({
  page,
}, testInfo) => {
  await prepareAssistantBoundary(page);
  const mounted = await page.evaluate(async () => {
    const [{ mount, unmount, tick }, { default: ChiefCard }, { store }, nav] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte'),
      import('/src/store/renderer/store.ts'),
      import('/src/store/renderer/slices/sidebar-nav/sidebar-nav-slice.ts'),
    ]);
    const target = document.createElement('div');
    document.body.append(target);
    const second = mount(ChiefCard, { target, props: { isActive: false } });
    await tick();
    await unmount(second);
    target.remove();
    const afterFirstUnmount = {
      panelItem: store.state.sidebarNav.panelItem,
      divider: store.state.unreadTracking.dividerSessionByAgentId['assistant-route-thread'],
    };
    store.dispatch(nav.closePanel());
    await tick();
    return afterFirstUnmount;
  });
  expect(mounted).toEqual({ panelItem: 'chief', divider: { anchorId: 'old-anchor' } });
  await expect(page.locator('[data-home-assistant]')).toHaveCount(0);
  await expect.poll(async () => (await assistantBoundaryState(page)).divider).toBeNull();
  await testInfo.attach('assistant-mount-ownership', {
    body: JSON.stringify({ mounted, closed: await assistantBoundaryState(page) }, null, 2),
    contentType: 'application/json',
  });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    for (const zoom of [1, 2]) {
      test(`control geometry and shortcut tooltips: ${theme}, zoom ${zoom}, motion ${reducedMotion}`, async ({
        page,
      }, testInfo) => {
        await page.emulateMedia({ reducedMotion });
        await mountControls(page, theme, zoom);
        const controls = [
          page.locator('[data-titlebar-spaces-control]'),
          page.locator('[data-workspace-repo-launcher] button'),
        ];
        // Home is a 48px tab; the workspace launcher remains 32px.
        for (const [index, control] of controls.entries()) {
          const width = index === 0 ? 48 : 32;
          // Startup zoom arrives asynchronously over IPC, then selector readables
          // schedule the titlebar's inverse-zoom layout update.
          await expect.poll(async () => (await control.boundingBox())?.width).toBeCloseTo(width, 0);
          const box = await control.boundingBox();
          expect(box?.height).toBeCloseTo(32, 0);
          await expect(control).not.toHaveAttribute('title', /.+/);
        }
        const sidebarControl = controls[0];
        await expect(sidebarControl).toHaveAttribute('aria-label', 'Home');
        await expect(sidebarControl).not.toHaveAttribute('aria-haspopup');
        await expect(sidebarControl).not.toHaveAttribute('aria-expanded');
        await expect(sidebarControl).not.toHaveAttribute('aria-controls');
        // #2441 reduces the launcher plus glyph to 14px; the Home glyph stays 16px.
        const glyphs: Array<[Locator, number]> = [
          [page.locator('[data-titlebar-spaces-control] svg'), 16],
          [page.locator('[data-workspace-repo-launcher] svg'), 14],
        ];
        for (const [glyph, glyphSize] of glyphs) {
          const box = await glyph.boundingBox();
          expect(box?.width).toBeCloseTo(glyphSize, 0);
          expect(box?.height).toBeCloseTo(glyphSize, 0);
          expect(await glyph.evaluate((node) => getComputedStyle(node).opacity)).toBe('1');
        }
        await sidebarControl.hover();
        await expect(page.locator('[data-tooltip-label]')).toBeVisible();
        await expect(page.locator('[data-tooltip-label]')).toHaveText('Open Home');
        await expect(page.locator('[data-tooltip-shortcut]')).toContainText(/(?:⌘|Ctrl\+)1/);
        await expect(page.locator('.sidebar-hover-card')).toHaveCount(0);
        if (reducedMotion === 'no-preference' && zoom === 1) {
          await testInfo.attach(theme + '-titlebar-controls', {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      });
    }
  }
}

test('modeled owner workspace creation remains withheld for unknown and guest callers', async ({
  page,
}) => {
  await mountControls(page, 'light', 1);
  const launcher = page.locator('[data-workspace-repo-launcher] button');
  await expect(launcher).toBeVisible();
  for (const role of ['unknown', 'guest'] as const) {
    await page.evaluate(async (role) => {
      const [{ store }, { principalContextChanged }, { admitLegacyPrincipal }] = await Promise.all([
        import('/src/store/renderer/store.ts'),
        import('/src/store/renderer/slices/principal/principal-slice.ts'),
        import('/src/test/fixtures/principal-state.ts'),
      ]);
      if (role === 'unknown') store.dispatch(principalContextChanged(null));
      else admitLegacyPrincipal('guest');
    }, role);
    await expect(launcher).toHaveCount(0);
  }
});

import { checkFixturePrincipalLifecycle } from './fixture-principal-lifecycle';

for (const borrowed of [true, false]) {
  test(`principal lifecycle restores ${borrowed ? 'a borrowed guest' : 'a fresh store'}`, async ({
    page,
  }, info) => {
    await checkFixturePrincipalLifecycle(
      page,
      info,
      baseUrl,
      'TitlebarWorkspaceControlsHarness',
      borrowed,
    );
  });
}
