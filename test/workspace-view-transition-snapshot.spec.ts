import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

type Mode = 'single' | 'columns';

let server: ViteDevServer;
let baseUrl = '';

test.describe.configure({ mode: 'serial', timeout: 120_000 });

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  server = await createServer({
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
  expect(baseUrl).not.toBe('');
});

test.afterAll(async () => server?.close());

interface FrameState {
  mode: string | null;
  layoutCount: number;
  activeCount: number;
  content: string;
  width: number;
  height: number;
  transitionNames: number;
  transitionClass: boolean;
}

async function exerciseImmediateSwitch(page: Page, from: Mode, to: Mode) {
  await page.addInitScript(() => Object.assign(globalThis, { process: { env: {} } }));
  await page.goto(`${baseUrl}src/features/workspace/workspace-view-mode-action.ts`);

  return page.evaluate(
    async ({ from, to }) => {
      const transitionModule = await import(
        `/src/features/workspace/workspace-view-mode-action.ts?proof=${from}-${to}`
      );
      const ids = ['ws-2', 'ws-1'];
      const activeId = 'ws-2';
      let mode: Mode = from;
      let nativeTransitionCalls = 0;
      const store = {
        get state() {
          return { tabState: { viewMode: mode, currentTabId: activeId } };
        },
        dispatch(action: { payload: [Mode] }) {
          mode = action.payload[0];
        },
      };
      const render = () => {
        const markers = ids.map((id) => `<div data-workspace-tab="${id}">${id}</div>`).join('');
        const columns = ids
          .map(
            (id) => `<section class="surface" data-workspace-column="${id}"
              data-workspace-transition-chrome="${id}" data-workspace-surface-state="live"
              ${id === activeId ? 'data-proof-active' : ''}>
              <strong>${id === activeId ? 'Active workspace content' : 'Secondary workspace'}</strong>
              <div data-workspace-transition-content="${id}">Visible panel chrome</div>
            </section>`,
          )
          .join('');
        document.body.innerHTML = `<style>
          html,body{margin:0;background:#f3f3f1;font:14px system-ui;color:#242424}
          [data-proof-layout]{display:flex;gap:12px;margin:32px;padding:16px;background:white;overflow:auto}
          .surface{box-sizing:border-box;flex:0 0 500px;width:500px;min-height:180px;padding:18px;background:#e9e8ff}
        </style><div data-titlebar-workspace-controls>Controls</div>
          <aside data-sidebar-panel-frame>Sidebar</aside>
          ${
            mode === 'single'
              ? `<div data-workspace-tab-strip>${markers}</div><div data-proof-layout>
                  <main class="workspace-main surface" data-proof-active>
                  <strong>Active workspace content</strong><div>Visible panel chrome</div></main></div>`
              : `<div data-workspace-columns data-proof-layout>${columns}</div>`
          }`;
      };
      const capture = (): FrameState => {
        const active = document.querySelector<HTMLElement>('[data-proof-active]');
        const rect = active?.getBoundingClientRect();
        return {
          mode: document.querySelector('[data-workspace-columns]') ? 'columns' : 'single',
          layoutCount: document.querySelectorAll('[data-proof-layout]').length,
          activeCount: document.querySelectorAll('[data-proof-active]').length,
          content: active?.textContent?.trim() ?? '',
          width: rect?.width ?? 0,
          height: rect?.height ?? 0,
          transitionNames: document.querySelectorAll('[data-workspace-transition-name]').length,
          transitionClass: document.documentElement.classList.contains('workspace-view-transition'),
        };
      };

      render();
      Object.defineProperty(document, 'startViewTransition', {
        configurable: true,
        value: () => {
          nativeTransitionCalls += 1;
          throw new Error('native snapshots must remain disabled');
        },
      });
      const start = capture();
      const switching = transitionModule.setWorkspaceViewModeWithTransition(to, {
        store,
        documentRef: document,
        afterUpdate: async () => render(),
      });
      await Promise.resolve();
      const midpoint = capture();
      const watchdog: FrameState[] = [];
      for (let frame = 0; frame < 8; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        watchdog.push(capture());
      }
      await switching;
      const end = capture();
      transitionModule.cancelWorkspaceViewModeTransition(document);
      return { start, midpoint, end, watchdog, nativeTransitionCalls };
    },
    { from, to },
  );
}

function expectCoherentFrame(frame: FrameState, mode: Mode) {
  expect(frame).toMatchObject({
    mode,
    layoutCount: 1,
    activeCount: 1,
    transitionNames: 0,
    transitionClass: false,
  });
  expect(frame.content).toContain('Active workspace content');
  expect(frame.width).toBe(500);
  expect(frame.height).toBeGreaterThan(0);
}

test('keeps start, midpoint, and end coherent in both directions and widths', async ({
  page,
}, testInfo) => {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    await page.emulateMedia({ reducedMotion });
    for (const viewport of [1180, 560]) {
      await page.setViewportSize({ width: viewport, height: 600 });
      for (const [from, to] of [
        ['single', 'columns'],
        ['columns', 'single'],
      ] as const) {
        const proof = await exerciseImmediateSwitch(page, from, to);
        expectCoherentFrame(proof.start, from);
        expectCoherentFrame(proof.midpoint, to);
        proof.watchdog.forEach((frame) => expectCoherentFrame(frame, to));
        expectCoherentFrame(proof.end, to);
        expect(proof.nativeTransitionCalls).toBe(0);
        if (reducedMotion === 'no-preference') {
          await testInfo.attach(`${from}-to-${to}-${viewport}px`, {
            body: await page.screenshot(),
            contentType: 'image/png',
          });
        }
      }
    }
  }
});
