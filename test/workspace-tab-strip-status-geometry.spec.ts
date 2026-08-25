import { expect, test, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

let server: ViteDevServer;
let baseUrl: string;

const virtualPrefix = '\0workspace-tab-strip:';
const virtualModules: Record<string, string> = {
  '$app/navigation': 'export const goto = async () => {};',
  '$features/agent/services/active-streams-tracker': `
    export const activeStreamsTracker = {
      startPolling() {}, subscribe() { return () => {}; },
      getStreamingAgentIdsForWorkspace() { return []; },
    };`,
  '$features/workspace/utils/empty-window-destination': `
    export const resolveEmptyWindowDestination = () => '/';`,
  '$lib/components/ui/tooltip': `
    import Tooltip from '/src/lib/components/layout/__tests__/mocks/MockWorkspaceTooltipRich.svelte';
    export const TooltipRich = Tooltip;`,
  '$lib/components/workspace/WorkspaceHoverCard.svelte': `
    export { default } from '/src/lib/components/layout/__tests__/mocks/MockWorkspaceHoverCard.svelte';`,
  '$lib/components/workspace/utils/workspace-tab-status-presentation': `
    export const getWorkspaceTabStatusPresentation = (category) => ({
      icon: { iconName: category }, className: '', label: category.toUpperCase(),
    });
    export const formatWorkspaceTabStatusItems = (items) =>
      items.map((item) => item.category.toUpperCase()).join(' · ');
    export const formatWorkspaceTabStatusSummary = (status) =>
      status.categories.map((item) => item.category.toUpperCase()).join(' · ');`,
  '$lib/components/workspace/utils/workspace-status-presentation': `
    export const resolveWorkspaceStatusState = (workspace) => workspace.displayStatus ?? 'idle';
    export const getWorkspaceStatusPresentation = (state) => ({
      state, visual: 'dot', icon: null, className: '', accessibleName: state,
    });`,
  '$store/renderer/slices/tab-state/tab-state-slice': `
    export const closeWorkspaceTab = (...payload) => ({ type: 'close', payload });
    export const endDrag = () => ({ type: 'endDrag' });
    export const moveWorkspace = (...payload) => ({ type: 'move', payload });
    export const openWorkspaceTab = (...payload) => ({ type: 'open', payload });
    export const startDrag = () => ({ type: 'startDrag' });`,
  '$store/renderer/slices/tab-state/tab-state-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectCurrentWorkspaceTabId = Object.assign(
      () => readable(() => globalThis.__workspaceTabScenario.currentId),
      { select: () => globalThis.__workspaceTabScenario.currentId },
    );
    export const selectWorkspaceTabOrder = () =>
      readable(() => globalThis.__workspaceTabScenario.tabOrder);`,
  '$store/renderer/slices/workspace/workspace-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectWorkspaceItems = Object.assign(
      () => readable(() => globalThis.__workspaceTabScenario.workspaces),
      { select: () => globalThis.__workspaceTabScenario.workspaces },
    );`,
  '$store/renderer/slices/hud/hud-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectWorkspaceTabStatuses = () =>
      readable(() => globalThis.__workspaceTabScenario.statuses);`,
  '$store/renderer/store': `
    export const store = { dispatch() {}, get state() { return {}; } };`,
  '$shared/paraglide/messages.js': `
    export const m = {
      layout_workspaceTabStrip_openSpaces_ariaLabel: () => 'Open spaces',
      layout_workspaceTabStrip_untitled_label: () => 'Untitled',
      layout_workspaceTabStrip_status_ariaLabel: ({ name, statuses }) => name + '. ' + statuses,
      layout_workspaceTabStrip_reorderAnnouncement: ({ name, position }) => name + ' ' + position,
      layout_workspaceTabStrip_close_ariaLabel: ({ name }) => 'Close ' + name,
      layout_workspaceTabStrip_loading_ariaLabel: ({ workspaceId }) => 'Loading ' + workspaceId,
      workspace_statusIcon_failed_label: () => 'Failed',
      workspace_statusIcon_blocked_label: () => 'Blocked',
      workspace_statusIcon_needsAttention_label: () => 'Needs attention',
      workspace_statusIcon_inProgress_label: () => 'In progress',
      workspace_taskStatus_waiting_label: () => 'Waiting',
      hud_workspaceState_unread_label: () => 'Unread',
      workspace_statusIcon_notStarted_label: () => 'Not started',
      workspace_statusIcon_idle_label: () => 'Idle',
      workspace_statusIcon_complete_label: () => 'Complete',
      workspace_statusIcon_prReady_label: () => 'PR ready',
      workspace_statusIcon_prOpen_label: () => 'PR open',
      workspace_statusIcon_prMerged_label: () => 'PR merged',
    };`,
  '@fortawesome/free-solid-svg-icons': `
    export const faCircleCheck = { iconName: 'circle-check' };
    export const faCircleQuestion = { iconName: 'circle-question' };
    export const faClock = { iconName: 'clock' };
    export const faCodeMerge = { iconName: 'code-merge' };
    export const faCodePullRequest = { iconName: 'code-pull-request' };
    export const faEllipsis = { iconName: 'ellipsis' };
    export const faTriangleExclamation = { iconName: 'triangle-exclamation' };
    export const faXmark = { iconName: 'xmark' };`,
};

function geometryStubs(): Plugin {
  const aliasRoots = new Map([
    ['$lib', resolve(process.cwd(), 'src/lib')],
    ['$store', resolve(process.cwd(), 'src/store')],
    ['$features', resolve(process.cwd(), 'src/features')],
    ['$shared', resolve(process.cwd(), 'src/shared')],
    ['$app', resolve(process.cwd(), 'playwright/app-stubs')],
  ]);
  const canonicalSource = (source: string) => {
    if (source in virtualModules) return source;
    for (const [alias, root] of aliasRoots) {
      const key = [...Object.keys(virtualModules)].find(
        (candidate) =>
          candidate.startsWith(`${alias}/`) &&
          source === resolve(root, candidate.slice(alias.length + 1)),
      );
      if (key) return key;
    }
    return null;
  };
  return {
    name: 'workspace-tab-strip-geometry-stubs',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'svelte-fa')
        return resolve(process.cwd(), 'src/lib/components/ui/__tests__/mocks/Fa.svelte');
      const canonical = canonicalSource(source);
      if (canonical) return virtualPrefix + canonical;
      return null;
    },
    load(id) {
      return id.startsWith(virtualPrefix) ? virtualModules[id.slice(virtualPrefix.length)] : null;
    },
  };
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    plugins: [geometryStubs(), svelte({ configFile: resolve(process.cwd(), 'svelte.config.js') })],
    resolve: {
      alias: {
        $lib: resolve(process.cwd(), 'src/lib'),
        $store: resolve(process.cwd(), 'src/store'),
        $features: resolve(process.cwd(), 'src/features'),
        $shared: resolve(process.cwd(), 'src/shared'),
      },
    },
    server: { host: '127.0.0.1', port: 0, strictPort: false, watch: { ignored: ['**/*'] } },
  });
  await server.listen();
  baseUrl = server.resolvedUrls?.local[0] ?? '';
});

test.afterAll(async () => server?.close());

async function mountStrip(
  page: Page,
  options: {
    viewport: number;
    zoom: number;
    reduced: boolean;
    panelOpen?: boolean;
    panelWidth?: number;
  },
) {
  await page.setViewportSize({ width: options.viewport, height: 360 });
  await page.emulateMedia({ reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; overflow: hidden; }' });
  await page.evaluate(async ({ zoom, panelOpen, panelWidth }) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    Object.assign(globalThis, {
      __workspaceTabScenario: {
        currentId: 'active',
        tabOrder: ['active', 'inactive', 'plain', 'loading'],
        workspaces: [
          { id: 'active', title: 'Active workspace with a materially longer title' },
          { id: 'inactive', title: 'Inactive workspace with a materially longer title' },
          { id: 'plain', title: 'Workspace with the default idle status' },
        ],
        statuses: {
          active: statusValue(['running']),
          inactive: statusValue(['failed', 'blocker', 'question', 'review']),
        },
      },
    });
    function statusValue(categories: string[]) {
      const items = categories.map((category) => ({ category, count: 1, agentNames: [] }));
      return { agentCount: 1, categories: items, visibleCategories: items, hiddenCategoryCount: 0 };
    }
    const [{ mount, tick }, { default: Strip }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/layout/WorkspaceTabStrip.svelte'),
    ]);
    document.body.replaceChildren();
    const target = document.createElement('div');
    document.body.append(target);
    if (panelOpen === undefined || panelWidth === undefined) {
      target.style.cssText = `width:100%; padding:24px; zoom:${zoom};`;
      mount(Strip, { target });
    } else {
      target.style.cssText = `width:100%; zoom:${zoom};`;
      const controls = document.createElement('div');
      controls.dataset.titlebarWorkspaceControls = '';
      controls.style.cssText = `display:flex;align-items:center;gap:4px;margin-left:${panelOpen ? panelWidth + 8 : 116}px;width:fit-content;`;
      target.append(controls);
      mount(Strip, { target: controls, props: { alignFirstTabToPanel: panelOpen } });

      const launcher = document.createElement('button');
      launcher.dataset.workspaceRepoLauncher = '';
      launcher.style.cssText = 'width:32px;height:32px;';
      controls.append(launcher);

      const frame = document.createElement('div');
      frame.style.cssText = 'display:flex;padding-left:8px;width:100%;';
      const sidebar = document.createElement('div');
      sidebar.dataset.sidebarPanelFrame = '';
      sidebar.style.cssText = `flex:0 0 ${panelOpen ? panelWidth : 0}px;`;
      const main = document.createElement('main');
      main.className = 'workspace-main';
      main.style.cssText = 'height:200px;min-width:0;flex:1;';
      frame.append(sidebar, main);
      target.append(frame);

      Object.assign(globalThis, {
        __setWorkspacePanelWidth(width: number) {
          if (!panelOpen) return;
          sidebar.style.flexBasis = `${width}px`;
          controls.style.marginLeft = `${width + 8}px`;
        },
      });
    }
    await tick();
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  }, options);
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

test('aligns the first tab with the open workspace panel across resize and zoom', async ({
  page,
}) => {
  for (const zoom of [1, 2]) {
    await mountStrip(page, {
      viewport: 1400,
      zoom,
      reduced: true,
      panelOpen: true,
      panelWidth: 288,
    });

    for (const panelWidth of [288, 420]) {
      await page.evaluate((width) => {
        (
          globalThis as typeof globalThis & { __setWorkspacePanelWidth: (value: number) => void }
        ).__setWorkspacePanelWidth(width);
      }, panelWidth);
      const [firstTab, workspaceMain] = await Promise.all([
        box(page.locator('[data-workspace-tab]').first()),
        box(page.locator('.workspace-main')),
      ]);
      expect(Math.abs(firstTab.x - workspaceMain.x) / zoom).toBeLessThanOrEqual(1);
    }
  }
});

test('preserves the collapsed-sidebar first-tab clearance across zoom', async ({ page }) => {
  for (const zoom of [1, 2]) {
    await mountStrip(page, {
      viewport: 1400,
      zoom,
      reduced: true,
      panelOpen: false,
      panelWidth: 288,
    });
    const [firstTab, controls] = await Promise.all([
      box(page.locator('[data-workspace-tab]').first()),
      box(page.locator('[data-titlebar-workspace-controls]')),
    ]);
    expect(firstTab.x - controls.x).toBeCloseTo(8 * zoom, 0);
  }
});

test('keeps titles, statuses, and close controls disjoint at 160px and constrained widths', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const options of [
    { viewport: 900, zoom: 1, reduced: false },
    { viewport: 900, zoom: 2, reduced: true },
    { viewport: 320, zoom: 1, reduced: true },
    { viewport: 320, zoom: 2, reduced: false },
  ]) {
    await mountStrip(page, options);
    const scale = options.zoom;
    const active = page.locator('[data-workspace-tab="active"]');
    const inactive = page.locator('[data-workspace-tab="inactive"]');
    const plain = page.locator('[data-workspace-tab="plain"]');
    const loading = page.locator('[data-workspace-tab="loading"]');
    const activeTitle = active.locator('[data-workspace-tab-title]');
    const activeStatus = active.locator('[data-workspace-tab-status-cluster]');
    const activeClose = active.locator('[data-workspace-tab-close]');
    const inactiveTitle = inactive.locator('[data-workspace-tab-title]');
    const inactiveStatus = inactive.locator('[data-workspace-tab-status-cluster]');
    const inactiveClose = inactive.locator('[data-workspace-tab-close]');

    const [activeBox, titleBox, statusBox, closeBox] = await Promise.all([
      box(active),
      box(activeTitle),
      box(activeStatus),
      box(activeClose),
    ]);
    expect(titleBox.x - activeBox.x).toBeCloseTo(12 * scale, 0);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x + 0.5);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(closeBox.x + 0.5);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(activeBox.x + activeBox.width + 0.5);
    expect(titleBox.width).toBeCloseTo(activeBox.width - 58 * scale, 0);
    await expect(active).toHaveAttribute('data-active', 'true');
    await expect(inactive).toHaveAttribute('data-active', 'false');
    await expect(active.locator('[role="tab"]')).toHaveAttribute(
      'aria-label',
      'Active workspace with a materially longer title. RUNNING',
    );

    const [inactiveTitleBox, inactiveStatusBox, inactiveCloseBox] = await Promise.all([
      box(inactiveTitle),
      box(inactiveStatus),
      box(inactiveClose),
    ]);
    expect(inactiveTitleBox.x + inactiveTitleBox.width).toBeLessThanOrEqual(
      inactiveStatusBox.x + 0.5,
    );
    expect(inactiveStatusBox.x + inactiveStatusBox.width).toBeLessThanOrEqual(
      inactiveCloseBox.x + 0.5,
    );
    expect(inactiveTitleBox.width).toBeCloseTo(titleBox.width, 0);
    await expect(inactiveStatus.locator('[data-workspace-status]')).toHaveCount(1);

    await expect(plain.locator('[data-workspace-status="idle"]')).toHaveCount(1);
    const [plainTitleBox, plainCloseBox] = await Promise.all([
      box(plain.locator('[data-workspace-tab-title]')),
      box(plain.locator('[data-workspace-tab-close]')),
    ]);
    expect(plainTitleBox.x + plainTitleBox.width).toBeLessThanOrEqual(plainCloseBox.x + 0.5);
    expect(plainTitleBox.width).toBeCloseTo(titleBox.width, 0);

    await expect(loading).toHaveAttribute('data-workspace-tab-loading', 'true');
    await expect(loading.locator('[data-workspace-tab-status-cluster]')).toHaveCount(0);
    const [loadingIndicatorBox, loadingCloseBox] = await Promise.all([
      box(loading.locator('[data-workspace-tab-loading-indicator]')),
      box(loading.locator('[data-workspace-tab-close]')),
    ]);
    expect(loadingIndicatorBox.x + loadingIndicatorBox.width).toBeLessThan(loadingCloseBox.x);

    const strip = page.locator('[data-workspace-tab-strip]');
    expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
      options.viewport / options.zoom < 660,
    );
    if (options.reduced) {
      const transitionSeconds = await active.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).transitionDuration),
      );
      expect(transitionSeconds).toBeLessThanOrEqual(0.00001);
    }
  }
});

test('focus, close hover, and drag keep the right-side geometry stable', async ({ page }) => {
  await mountStrip(page, { viewport: 900, zoom: 1, reduced: true });
  const active = page.locator('[data-workspace-tab="active"]');
  const title = active.locator('[data-workspace-tab-title]');
  const status = active.locator('[data-workspace-tab-status-cluster]');
  const close = active.locator('[data-workspace-tab-close]');
  const before = await Promise.all([box(title), box(status), box(close)]);

  await active.locator('[role="tab"]').focus();
  await close.hover();
  expect(await Promise.all([box(title), box(status), box(close)])).toEqual(before);

  await active.evaluate((node) => {
    const dataTransfer = new DataTransfer();
    node.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
  });
  await expect(active).toHaveAttribute('data-dragging', 'true');
  const [dragTitle, dragStatus, dragClose] = await Promise.all([
    box(title),
    box(status),
    box(close),
  ]);
  expect(dragTitle.x + dragTitle.width).toBeLessThanOrEqual(dragStatus.x + 0.5);
  expect(dragStatus.x + dragStatus.width).toBeLessThanOrEqual(dragClose.x + 0.5);
});

test('drag keeps one horizontal real tab and drops it at the proposed placeholder', async ({
  page,
}) => {
  await mountStrip(page, { viewport: 900, zoom: 1, reduced: false });
  const strip = page.locator('[data-workspace-tab-strip]');
  const active = page.locator('[data-workspace-tab="active"]');
  const origin = await box(active);
  const loading = await box(page.locator('[data-workspace-tab="loading"]'));
  const startX = origin.x + origin.width / 2;
  const dragX = loading.x + loading.width + 4;

  await active.evaluate(
    (node, point) => {
      const dataTransfer = new DataTransfer();
      (
        globalThis as typeof globalThis & { __workspaceDragData?: DataTransfer }
      ).__workspaceDragData = dataTransfer;
      node.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
        }),
      );
    },
    { x: startX, y: origin.y + origin.height / 2 },
  );
  await strip.evaluate(
    (node, point) => {
      const dataTransfer = (
        globalThis as typeof globalThis & { __workspaceDragData?: DataTransfer }
      ).__workspaceDragData;
      node.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
        }),
      );
    },
    { x: dragX, y: origin.y + origin.height + 200 },
  );

  const placeholder = page.locator('[data-workspace-tab-placeholder="active"]');
  await expect(placeholder).toBeVisible();
  await expect(active).toHaveCSS('position', 'fixed');
  const dragged = await box(active);
  const proposed = await box(placeholder);
  expect(dragged.x).toBeCloseTo(origin.x + dragX - startX, 1);
  expect(dragged.y).toBeCloseTo(origin.y, 1);
  expect(
    await page
      .locator('[data-workspace-tab-motion]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-workspace-tab-motion'))),
  ).toEqual(['inactive', 'plain', 'loading', 'active']);
  await expect(page.locator('[data-workspace-stack-preview]')).toHaveCount(0);

  await strip.evaluate(
    (node, point) => {
      const dataTransfer = (
        globalThis as typeof globalThis & { __workspaceDragData?: DataTransfer }
      ).__workspaceDragData;
      node.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer,
          clientX: point.x,
          clientY: point.y,
        }),
      );
    },
    { x: dragX, y: origin.y + origin.height + 200 },
  );

  await expect(placeholder).toHaveCount(0);
  await expect(active).not.toHaveCSS('position', 'fixed');
  const dropped = await box(active);
  expect(dropped.x).toBeCloseTo(proposed.x, 1);
  expect(dropped.x).not.toBeCloseTo(origin.x, 1);
});
