/**
 * Build Smoke Test — a new browser shows after "Open in own window"
 *
 * With Labs "Browser pages in the main process" on, a browser tab moved to
 * its own window must not stop new browser tabs from showing in the main
 * window: the new tab's panel is on screen and main shows its page there.
 *
 * Run with: pnpm test:build-smoke -- e2e/build-smoke-tab-window-browser.e2e.ts
 */

import { test, expect, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'fs/promises';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import * as path from 'path';
import {
  launchPackagedApp,
  createTempRepo,
  createWorkspaceWithPrompt,
  setMockAgentBehavior,
  exitPackagedApp,
  selectSidebarSection,
} from './build-smoke-helpers';

const SCREENSHOT_DIR = path.join(process.cwd(), 'e2e-reports', 'build-smoke');

let app: ElectronApplication;
let page: Page;
let repoCleanup: (() => void) | undefined;
let repoPath: string;
let server: Server;
let origin: string;

async function screenshot(name: string): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `tab-window-browser-${name}.png`) });
}

/** Browser tab ids in the main window's DOM, in tab-bar order. */
async function browserTabIds(): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-sidebar-browser-tab]')].map(
      (node) => node.dataset.sidebarBrowserTab ?? '',
    ),
  );
}

/** Every native view tree, per window (diagnostics for the reproduction). */
async function viewTree(): Promise<unknown> {
  return app.evaluate(({ BrowserWindow, WebContentsView }) => {
    const walk = (view: Electron.View): unknown => {
      const bounds = view.getBounds();
      const contents = view instanceof WebContentsView ? view.webContents : null;
      return {
        url: contents ? contents.getURL().slice(0, 60) : null,
        visible: view.getVisible(),
        bounds: `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`,
        children: view.children.map(walk),
      };
    };
    return BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      title: window.getTitle(),
      url: window.webContents.getURL(),
      bounds: window.getBounds(),
      tree: walk(window.contentView),
    }));
  });
}

/** Main-owned pages on screen in the window that hosts `page` (non-empty bounds, on top of it). */
async function shownPagesInMainWindow(): Promise<
  Array<{ url: string; x: number; y: number; width: number; height: number }>
> {
  const pageUrl = page.url();
  return app.evaluate(({ BrowserWindow, WebContentsView }, hostUrl) => {
    const host = BrowserWindow.getAllWindows().find(
      (window) =>
        window.contentView.children.some(
          (view) => view instanceof WebContentsView && view.webContents.getURL() === hostUrl,
        ) || window.webContents.getURL() === hostUrl,
    );
    if (!host) return [];
    const children = host.contentView.children;
    const hostIndex = children.findIndex(
      (view) => view instanceof WebContentsView && view.webContents.getURL() === hostUrl,
    );
    return children
      .map((view, index) => ({ view, index }))
      .filter(
        ({ view, index }) =>
          view instanceof WebContentsView &&
          index > hostIndex &&
          view.getVisible() &&
          !/^(app|file|intent):/.test(view.webContents.getURL()),
      )
      .map(({ view }) => {
        const bounds = view.getBounds();
        return {
          url: (view as Electron.WebContentsView).webContents.getURL(),
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        };
      })
      .filter((entry) => entry.width > 0 && entry.height > 0);
  }, pageUrl);
}

/**
 * Wait until the tab is the active tab of a panel on screen, and main shows a
 * page with the tab's address over that panel in the main window.
 */
async function expectBrowserShown(tabId: string, pagePath: string): Promise<void> {
  const frameRect = () =>
    page.evaluate((id) => {
      const node = document.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(id)}"] [data-browser-tab-frame]`,
      );
      if (!node || node.offsetParent === null || node.closest('[aria-hidden="true"]')) return null;
      const rect = node.getBoundingClientRect();
      const onScreen =
        rect.width > 50 &&
        rect.height > 50 &&
        rect.left >= -1 &&
        rect.right <= window.innerWidth + 1 &&
        getComputedStyle(node).visibility !== 'hidden';
      return onScreen ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
    }, tabId);
  await expect
    .poll(async () => (await frameRect()) !== null, {
      timeout: 20_000,
      message: `browser tab ${tabId} (${pagePath}) is on screen in a panel`,
    })
    .toBe(true)
    .catch(async (error: unknown) => {
      await dumpDiagnostics(tabId);
      throw error;
    });
  await expect
    .poll(
      async () => {
        const frame = await frameRect();
        if (!frame) return false;
        // The page sits inside the tab's frame (below its toolbar).
        return (await shownPagesInMainWindow()).some(
          (shown) =>
            shown.url.endsWith(pagePath) &&
            shown.x >= frame.x - 2 &&
            shown.x + shown.width <= frame.x + frame.width + 2 &&
            shown.y >= frame.y - 2 &&
            shown.y + shown.height <= frame.y + frame.height + 2,
        );
      },
      { timeout: 20_000, message: `main shows ${pagePath} over its panel in the main window` },
    )
    .toBe(true)
    .catch(async (error: unknown) => {
      await dumpDiagnostics(tabId);
      throw error;
    });
}

/**
 * The windows that show a page whose address ends with `pagePath` (visible,
 * non-empty bounds), as 'tab' for a tab window and 'other' for any other.
 */
async function windowsShowingPage(pagePath: string): Promise<Array<'tab' | 'other'>> {
  return app.evaluate(({ BrowserWindow, WebContentsView }, wanted) => {
    const kinds: Array<'tab' | 'other'> = [];
    for (const window of BrowserWindow.getAllWindows()) {
      const views = window.contentView.children.filter(
        (view): view is Electron.WebContentsView => view instanceof WebContentsView,
      );
      const isTabWindow = [window.webContents, ...views.map((view) => view.webContents)].some(
        (contents) => contents.getURL().includes('/tab-window/'),
      );
      const shows = views.some((view) => {
        const bounds = view.getBounds();
        return (
          view.getVisible() &&
          bounds.width > 0 &&
          bounds.height > 0 &&
          view.webContents.getURL().endsWith(wanted)
        );
      });
      if (shows) kinds.push(isTabWindow ? 'tab' : 'other');
    }
    return kinds;
  }, pagePath);
}

async function dumpDiagnostics(tabId: string): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  await screenshot(`failed-${tabId}`).catch(() => undefined);
  await fs.writeFile(
    path.join(SCREENSHOT_DIR, `tab-window-browser-views-${tabId}.json`),
    JSON.stringify(
      {
        pageUrl: page.url(),
        lab: await page.evaluate(() =>
          (window as any).electronAPI?.invoke('browser-view:get-lab', {}).catch(String),
        ),
        panels: await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-panel-id]')].map((panel) => {
            const rect = panel.getBoundingClientRect();
            return {
              id: panel.dataset.panelId,
              rect: [rect.x, rect.y, rect.width, rect.height].map(Math.round),
              tabs: [...panel.querySelectorAll<HTMLElement>('[data-tab-id]')].map((tab) => ({
                id: tab.dataset.tabId,
                hidden: tab.getAttribute('aria-hidden'),
              })),
            };
          }),
        ),
        shown: await shownPagesInMainWindow().catch(String),
        windows: await viewTree(),
      },
      null,
      1,
    ),
  );
}

/** "New Browser" in the sidebar, then load `pagePath` in it. Returns the new tab id. */
async function createBrowserFromSidebar(pagePath: string): Promise<string> {
  const before = new Set(await browserTabIds());
  await page.getByRole('button', { name: 'New Browser' }).first().click();
  let created = '';
  await expect
    .poll(
      async () => {
        created = (await browserTabIds()).find((id) => !before.has(id)) ?? '';
        return created;
      },
      { timeout: 15_000, message: 'a new browser row in the sidebar' },
    )
    .not.toBe('');
  const address = page.locator(`[data-tab-id="${created}"] [data-browser-toolbar] input`).first();
  await address.fill(`${origin}${pagePath}`).catch(async (error: unknown) => {
    await dumpDiagnostics(created);
    throw error;
  });
  await address.press('Enter');
  return created;
}

/**
 * The main window's app page: the machine view inside the main frame. The
 * launch helper's first window can be another app window (dock/HUD), where
 * main-owned pages are never placed.
 */
async function machineViewPage(): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        await app.evaluate(({ BrowserWindow, WebContentsView }) => {
          for (const window of BrowserWindow.getAllWindows()) {
            for (const view of window.contentView.children) {
              if (view instanceof WebContentsView) {
                void view.webContents.executeJavaScript('window.__e2eMachineView = true');
              }
            }
          }
        });
        for (const candidate of app.windows()) {
          const marked = await candidate
            .evaluate(() => (window as any).__e2eMachineView === true)
            .catch(() => false);
          if (marked) {
            found = candidate;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000, message: 'the main frame machine view page' },
    )
    .toBe(true);
  return found!;
}

/**
 * Serve test pages, make a repo, and launch the app. Intent OS sets only
 * INTENT_OS=1 (its launcher does); the Labs setting is on by its default
 * there. Elsewhere the test turns the Labs setting on.
 */
async function launch(intentOs: boolean, prefs: Record<string, unknown> = {}): Promise<void> {
  server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><title>${request.url}</title><h1>${request.url}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const repo = createTempRepo();
  repoPath = repo.repoPath;
  repoCleanup = repo.cleanup;
  const launched = await launchPackagedApp({
    extraEnv: {
      MOCK_AGENT_SCRIPT_PATH: path.resolve(process.cwd(), 'e2e', 'mock-acp-agent.js'),
      ...(intentOs ? { INTENT_OS: '1' } : {}),
    },
    localPrefs: intentOs ? prefs : { browserViewsInMainEnabled: true, ...prefs },
  });
  app = launched.app;
  page = await machineViewPage();
}

async function tearDown(): Promise<void> {
  await exitPackagedApp(app);
  server?.close();
  try {
    repoCleanup?.();
  } catch {
    /* best-effort */
  }
}

test.describe('Build Smoke — browser after a tab window', () => {
  test.beforeEach(() => launch(false));
  test.afterEach(tearDown);

  for (const how of ['shortcut', 'menu'] as const) {
    test(`every browser shows after open in own window (${how}) and move back`, async () => {
      await runScenario(how);
    });
  }
});

test.describe('Build Smoke — browser tab window on Intent OS', () => {
  test.beforeEach(() => launch(true));
  test.afterEach(tearDown);

  test('the page shows in its tab window, not in the main window', async () => {
    await runScenario('shortcut');
  });
});

test.describe('Build Smoke — browser tab window on Intent OS with the dock', () => {
  test.beforeEach(() => launch(true, { dockEnabled: true }));
  test.afterEach(tearDown);

  test('the page shows in its tab window with the dock on', async () => {
    await runScenario('shortcut');
  });
});

/** Open the active browser tab `tabId` in its own window by the shortcut or the tab menu. */
async function openInOwnWindow(tabId: string, how: 'shortcut' | 'menu'): Promise<void> {
  if (how === 'shortcut') {
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    return;
  }
  // The tab's context menu (the tab bar item may be collapsed in a one-tab panel).
  await page.evaluate((id) => {
    const tab = document.querySelector<HTMLElement>(
      `[data-panel-id] button[data-tab-id="${CSS.escape(id)}"], [data-panel-id] [role="tab"][data-tab-id="${CSS.escape(id)}"]`,
    );
    if (!tab) throw new Error(`no tab bar item for ${id}`);
    tab.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 80 }),
    );
  }, tabId);
  await page.getByText('Open in Own Window', { exact: true }).click();
}

async function runScenario(how: 'shortcut' | 'menu'): Promise<void> {
  test.setTimeout(240_000);
  const mockEnv = setMockAgentBehavior({ response: 'Ready. TASK_COMPLETE' });
  await app.evaluate((_electron, env) => Object.assign(process.env, env), mockEnv);
  await createWorkspaceWithPrompt(page, {
    repoPath,
    prompt: 'Say ready',
    providerName: 'Mock (E2E)',
  });

  // A non-browser panel first, so the browser opens in a column of its own
  // next to it (the user's chat + browser layout).
  await selectSidebarSection(page, 'shell');
  await page.getByRole('button', { name: 'New Terminal' }).first().click();
  await page.getByRole('button', { name: 'Show in a panel' }).first().click({ timeout: 30_000 });
  await expect
    .poll(() => page.locator('[data-panel-id] [data-tab-id]').count(), { timeout: 20_000 })
    .toBeGreaterThan(0);
  await selectSidebarSection(page, 'browser');

  // 1. A browser tab shows.
  const first = await createBrowserFromSidebar('/first');
  await expectBrowserShown(first, '/first');
  await screenshot(`${how}-1-first-browser`);

  // 2. Open it in its own window (panel.tab-window: mod+shift+enter).
  const windowsBefore = new Set(app.windows());
  await page.locator(`[data-sidebar-browser-tab="${first}"]`).click();
  await expectBrowserShown(first, '/first');
  await openInOwnWindow(first, how);
  let tabWindow: Page | undefined;
  await expect
    .poll(
      () => {
        tabWindow = app.windows().find((candidate) => !windowsBefore.has(candidate));
        return !!tabWindow;
      },
      { timeout: 20_000, message: 'a tab window opened' },
    )
    .toBe(true);
  // The page moved with the tab: the tab window shows it, the main window does not.
  await expect
    .poll(() => windowsShowingPage('/first'), {
      timeout: 20_000,
      message: 'the first page shows in the tab window only',
    })
    .toEqual(['tab'])
    .catch(async (error: unknown) => {
      await dumpDiagnostics(`${how}-tab-window`);
      throw error;
    });
  await dumpDiagnostics(`${how}-after-own-window`);
  await page.bringToFront();
  await screenshot(`${how}-2-after-own-window`);

  // 3. A new browser from the sidebar shows in the main window.
  const second = await createBrowserFromSidebar('/second');
  await expectBrowserShown(second, '/second');
  await screenshot(`${how}-3-second-browser`);
  await dumpDiagnostics(`${how}-before-move-back`);

  // 4. Move the first tab back: it shows again, and every tab can be reached.
  await tabWindow!.getByTestId('tab-window-move-back').click();
  await expect
    .poll(() => app.windows().includes(tabWindow!), {
      timeout: 20_000,
      message: 'tab window closed',
    })
    .toBe(false);
  await page.bringToFront();
  await expectBrowserShown(first, '/first');
  await screenshot(`${how}-4-moved-back`);
  await dumpDiagnostics(`${how}-after-move-back`);
  for (const [tabId, pagePath] of [
    [second, '/second'],
    [first, '/first'],
  ] as const) {
    await page.locator(`[data-sidebar-browser-tab="${tabId}"]`).click();
    await expectBrowserShown(tabId, pagePath);
  }

  // 5. A new browser after the move back shows too.
  const third = await createBrowserFromSidebar('/third');
  await expectBrowserShown(third, '/third');
  await screenshot(`${how}-5-third-browser`);
}
