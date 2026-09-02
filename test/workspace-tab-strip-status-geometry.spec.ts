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
    const currentSubscribers = new Set();
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectCurrentWorkspaceTabId = Object.assign(
      () => ({ subscribe(run) {
        currentSubscribers.add(run);
        run(globalThis.__workspaceTabScenario.currentId);
        return () => currentSubscribers.delete(run);
      } }),
      { select: () => globalThis.__workspaceTabScenario.currentId },
    );
    globalThis.__setCurrentWorkspaceTabId = (workspaceId) => {
      globalThis.__workspaceTabScenario.currentId = workspaceId;
      currentSubscribers.forEach((run) => run(workspaceId));
    };
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
    export const store = {
      dispatch(action) { globalThis.__workspaceTabScenario.actions.push(action); },
      get state() { return {}; },
    };`,
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
    theme?: 'light' | 'dark';
    panelOpen?: boolean;
    panelWidth?: number;
  },
) {
  await page.setViewportSize({ width: options.viewport, height: 360 });
  await page.emulateMedia({ reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await page.goto(`${baseUrl}src/app.html`);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; overflow: hidden; }' });
  await page.evaluate(async ({ zoom, theme, panelOpen, panelWidth }) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
    Object.assign(globalThis, {
      __workspaceTabScenario: {
        currentId: 'active',
        actions: [],
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
    const [{ mount, tick, unmount }, { default: Strip }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/layout/WorkspaceTabStrip.svelte'),
    ]);
    document.body.replaceChildren();
    const target = document.createElement('div');
    target.className = 'window-title-bar';
    document.body.append(target);
    const mask = document.createElement('div');
    mask.dataset.activeTabBorderMask = '';
    mask.style.cssText = 'position:absolute;height:1px;';
    target.append(mask);
    const stripProps = {
      onActiveTabBoundsChange(bounds: { left: number; width: number } | null) {
        mask.style.left = bounds ? `${bounds.left - 6}px` : '';
        mask.style.width = bounds ? `${Math.max(0, bounds.width + 13)}px` : '';
      },
      onActiveTabTrackingChange(tracking: boolean) {
        mask.dataset.tracking = String(tracking);
        mask.style.transition = tracking
          ? 'none'
          : 'left 200ms cubic-bezier(0.215, 0.61, 0.355, 1)';
      },
    };
    if (panelOpen === undefined || panelWidth === undefined) {
      target.style.cssText = `position:relative;width:100%;padding:24px;zoom:${zoom};`;
      mount(Strip, { target, props: stripProps });
    } else {
      target.style.cssText = `position:relative;width:100%;zoom:${zoom};`;
      const controls = document.createElement('div');
      controls.dataset.titlebarWorkspaceControls = '';
      controls.style.cssText = 'display:flex;min-width:0;align-items:center;gap:4px;';
      target.append(controls);

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
      main.className =
        'workspace-main flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-sidebar border border-border shadow-sm';
      main.style.cssText = 'height:200px;';
      frame.append(sidebar, main);
      target.append(frame);

      let currentPanelOpen = panelOpen;
      let currentPanelWidth = panelWidth;
      let component: ReturnType<typeof mount> | null = null;
      const applyPanelLayout = () => {
        const offset = currentPanelOpen ? currentPanelWidth + 8 : 116;
        controls.style.marginLeft = `${offset}px`;
        controls.style.width = `calc(100% - ${offset}px)`;
        sidebar.style.flexBasis = `${currentPanelOpen ? currentPanelWidth : 0}px`;
      };
      const renderStrip = async () => {
        if (component) await unmount(component);
        component = mount(Strip, {
          target: controls,
          props: stripProps,
        });
        controls.append(launcher);
        await tick();
        await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      };
      applyPanelLayout();
      await renderStrip();

      Object.assign(globalThis, {
        __setWorkspacePanelWidth(width: number) {
          currentPanelWidth = width;
          applyPanelLayout();
        },
        async __setWorkspacePanelOpen(open: boolean) {
          currentPanelOpen = open;
          applyPanelLayout();
          await renderStrip();
        },
        __remountWorkspaceTabStrip: renderStrip,
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

async function settle(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

async function expectNormalActiveShape(
  page: Page,
  workspaceId: string,
  zoom: number,
  assertHeight = true,
) {
  const tab = page.locator(`[data-workspace-tab="${workspaceId}"]`);
  expect(await tab.getAttribute('data-workspace-tab-leading-shape')).toBeNull();
  const radii = await tab.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      leading: Number.parseFloat(style.borderTopLeftRadius),
      trailing: Number.parseFloat(style.borderTopRightRadius),
    };
  });
  expect(radii.leading).toBeGreaterThan(0);
  expect(radii.trailing).toBe(radii.leading);
  await expect(tab.locator('[data-workspace-tab-leading-flare]')).toHaveCount(1);
  await expect(tab.locator('[data-workspace-tab-trailing-flare]')).toHaveCount(1);
  if (assertHeight) expect((await box(tab)).height).toBeCloseTo(32 * zoom, 0);
  return radii;
}

async function expectPanelGutter(page: Page, zoom: number) {
  const tab = page.locator('[data-workspace-tab="active"]');
  const panel = page.locator('.workspace-main');
  const [tabBox, panelBox] = await Promise.all([box(tab), box(panel)]);
  expect(tabBox.x - panelBox.x).toBeCloseTo(24 * zoom, 0);
  expect(tabBox.y + tabBox.height).toBeCloseTo(panelBox.y, 0);
}

test('keeps the normal first-tab curve, both flares, and 24px panel gutter across the geometry matrix', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const scenarios = [
    { viewport: 1400, zoom: 1, reduced: false, panelWidths: [288, 420], overflow: false },
    { viewport: 1400, zoom: 2, reduced: true, panelWidths: [288, 420], overflow: true },
    { viewport: 760, zoom: 1, reduced: true, panelWidths: [96, 160], overflow: true },
    { viewport: 760, zoom: 2, reduced: false, panelWidths: [96, 160], overflow: true },
  ];

  for (const theme of ['light', 'dark'] as const) {
    for (const scenario of scenarios) {
      await mountStrip(page, {
        ...scenario,
        theme,
        panelOpen: true,
        panelWidth: scenario.panelWidths[0],
      });

      for (const panelWidth of scenario.panelWidths) {
        await page.evaluate((width) => {
          (
            globalThis as typeof globalThis & { __setWorkspacePanelWidth: (value: number) => void }
          ).__setWorkspacePanelWidth(width);
        }, panelWidth);
        await settle(page);
        const [firstTab, workspaceMain] = await Promise.all([
          box(page.locator('[data-workspace-tab]').first()),
          box(page.locator('.workspace-main')),
        ]);
        expect(firstTab.x - workspaceMain.x).toBeCloseTo(24 * scenario.zoom, 0);
        await expectNormalActiveShape(page, 'active', scenario.zoom);
        await expectPanelGutter(page, scenario.zoom);
      }

      const strip = page.locator('[data-workspace-tab-strip]');
      expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(
        scenario.overflow,
      );

      await page.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __setCurrentWorkspaceTabId: (workspaceId: string) => void;
          }
        ).__setCurrentWorkspaceTabId('inactive');
      });
      await settle(page);
      const normalActiveRadii = await expectNormalActiveShape(page, 'inactive', scenario.zoom);

      await page.evaluate(() => {
        (
          globalThis as typeof globalThis & {
            __setCurrentWorkspaceTabId: (workspaceId: string) => void;
            __remountWorkspaceTabStrip: () => Promise<void>;
          }
        ).__setCurrentWorkspaceTabId('active');
        return globalThis.__remountWorkspaceTabStrip();
      });
      const firstTabRadii = await expectNormalActiveShape(page, 'active', scenario.zoom);
      expect(firstTabRadii).toEqual(normalActiveRadii);
      await expectPanelGutter(page, scenario.zoom);

      await page.locator('[data-workspace-tab="active"]').evaluate((node) => {
        node.dispatchEvent(
          new DragEvent('dragstart', {
            bubbles: true,
            dataTransfer: new DataTransfer(),
            clientX: node.getBoundingClientRect().x + 20,
            clientY: node.getBoundingClientRect().y + 16,
          }),
        );
      });
      await expectNormalActiveShape(page, 'active', scenario.zoom, false);
      await page.locator('[data-workspace-tab="active"]').evaluate((node) => {
        node.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      });
      await settle(page);
      await page.locator('[data-workspace-tab-motion="active"]').evaluate(async (node) => {
        await Promise.all(
          node.getAnimations({ subtree: true }).map((animation) => animation.finished),
        );
      });
      await expectNormalActiveShape(page, 'active', scenario.zoom);
      await expectPanelGutter(page, scenario.zoom);

      await page.evaluate(() => {
        const scenarioState = (
          globalThis as typeof globalThis & {
            __workspaceTabScenario: { currentId: string; tabOrder: string[] };
            __remountWorkspaceTabStrip: () => Promise<void>;
          }
        ).__workspaceTabScenario;
        scenarioState.currentId = 'loading';
        scenarioState.tabOrder = ['loading', 'active', 'inactive', 'plain'];
        return globalThis.__remountWorkspaceTabStrip();
      });
      await expect(page.locator('[data-workspace-tab="loading"]')).toHaveAttribute(
        'data-workspace-tab-loading',
        'true',
      );
      expect(await expectNormalActiveShape(page, 'loading', scenario.zoom)).toEqual(
        normalActiveRadii,
      );

      await page.evaluate(() => {
        const scenarioState = (
          globalThis as typeof globalThis & {
            __workspaceTabScenario: { currentId: string; tabOrder: string[] };
            __remountWorkspaceTabStrip: () => Promise<void>;
          }
        ).__workspaceTabScenario;
        scenarioState.currentId = 'active';
        scenarioState.tabOrder = ['active', 'inactive', 'plain', 'loading'];
        return globalThis.__remountWorkspaceTabStrip();
      });
      await expectNormalActiveShape(page, 'active', scenario.zoom);
      await expectPanelGutter(page, scenario.zoom);

      await page.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            __setWorkspacePanelOpen: (open: boolean) => Promise<void>;
          }
        ).__setWorkspacePanelOpen(false),
      );
      await expectNormalActiveShape(page, 'active', scenario.zoom);

      await page.evaluate(() =>
        (
          globalThis as typeof globalThis & {
            __setWorkspacePanelOpen: (open: boolean) => Promise<void>;
          }
        ).__setWorkspacePanelOpen(true),
      );
      await expectNormalActiveShape(page, 'active', scenario.zoom);
      await expectPanelGutter(page, scenario.zoom);

      const transitionSeconds = await page
        .locator('[data-workspace-tab="active"]')
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration));
      expect(transitionSeconds <= 0.00001).toBe(scenario.reduced);
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
    expect(firstTab.x - controls.x).toBeCloseTo(24 * zoom, 0);
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
    expect(activeBox.width).toBeCloseTo(Math.min(160, options.viewport * 0.4) * scale, 0);
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
  const activeEdgeStyle = () =>
    active.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        borderBottomWidth: style.borderBottomWidth,
        boxShadow: style.boxShadow,
        position: style.position,
        zIndex: style.zIndex,
      };
    });

  expect(await activeEdgeStyle()).toEqual({
    borderBottomWidth: '0px',
    boxShadow: 'none',
    position: 'relative',
    zIndex: 'auto',
  });

  const tab = active.locator('[role="tab"]');
  await tab.focus();
  await close.hover();
  expect(await Promise.all([box(title), box(status), box(close)])).toEqual(before);

  const tabBox = await box(tab);
  await page.mouse.move(tabBox.x + 24, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(tabBox.x + 34, tabBox.y + tabBox.height / 2);
  await expect(active).toHaveAttribute('data-dragging', 'true');
  expect(await activeEdgeStyle()).toEqual({
    borderBottomWidth: '0px',
    boxShadow: 'none',
    position: 'fixed',
    zIndex: '50',
  });
  const [dragTitle, dragStatus, dragClose] = await Promise.all([
    box(title),
    box(status),
    box(close),
  ]);
  expect(dragTitle.x + dragTitle.width).toBeLessThanOrEqual(dragStatus.x + 0.5);
  expect(dragStatus.x + dragStatus.width).toBeLessThanOrEqual(dragClose.x + 0.5);
  await page.keyboard.press('Escape');
  await expect(active).toHaveAttribute('data-dragging', 'false');
  expect(await activeEdgeStyle()).toEqual({
    borderBottomWidth: '0px',
    boxShadow: 'none',
    position: 'relative',
    zIndex: 'auto',
  });
  expect(await Promise.all([box(title), box(status), box(close)])).toEqual(before);
  expect(
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __workspaceTabScenario: { actions: Array<{ type: string }> };
        }
      ).__workspaceTabScenario.actions.filter((action) => action.type === 'move'),
    ),
  ).toEqual([]);
});

test('Escape-cancelled real pointer drag suppresses its browser click', async ({ page }) => {
  await mountStrip(page, { viewport: 900, zoom: 1, reduced: true });
  const inactive = page.locator('[data-workspace-tab="inactive"]');
  const inactiveTab = inactive.locator('[role="tab"]');
  const tabBounds = await box(inactiveTab);
  const startX = tabBounds.x + 28;
  const pointerY = tabBounds.y + tabBounds.height / 2;
  const strip = page.locator('[data-workspace-tab-strip]');

  await page.evaluate(() => {
    const global = globalThis as typeof globalThis & { __cancelledTabClickTargets: string[] };
    global.__cancelledTabClickTargets = [];
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target as Element;
        const workspaceId = target
          .closest('[data-workspace-tab]')
          ?.getAttribute('data-workspace-tab');
        if (workspaceId) global.__cancelledTabClickTargets.push(workspaceId);
      },
      { capture: true },
    );
  });

  await page.mouse.move(startX, pointerY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, pointerY);
  await expect(inactive).toHaveAttribute('data-dragging', 'true');
  await page.keyboard.press('Escape');
  await expect(inactive).toHaveAttribute('data-dragging', 'false');
  await expect(page.locator('[data-workspace-tab-placeholder]')).toHaveCount(0);
  await expect(strip).toHaveCSS('cursor', 'auto');
  await page.mouse.up();

  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __cancelledTabClickTargets: string[] })
          .__cancelledTabClickTargets,
    ),
  ).toEqual(['inactive']);
  expect(
    await page.evaluate(() => {
      const scenario = (
        globalThis as typeof globalThis & {
          __workspaceTabScenario: {
            actions: Array<{ type: string; payload: unknown }>;
            currentId: string;
            tabOrder: string[];
          };
        }
      ).__workspaceTabScenario;
      return {
        actions: scenario.actions.filter((action) => ['open', 'move'].includes(action.type)),
        currentId: scenario.currentId,
        tabOrder: scenario.tabOrder,
      };
    }),
  ).toEqual({
    actions: [],
    currentId: 'active',
    tabOrder: ['active', 'inactive', 'plain', 'loading'],
  });
  await expect(page.locator('[data-workspace-tab="active"] [role="tab"]')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(inactiveTab).toHaveAttribute('aria-selected', 'false');

  await page.mouse.click(startX, pointerY);
  expect(
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __workspaceTabScenario: { actions: Array<{ type: string; payload: unknown }> };
        }
      ).__workspaceTabScenario.actions.filter((action) => ['open', 'move'].includes(action.type)),
    ),
  ).toEqual([{ type: 'open', payload: ['inactive'] }]);
});

test('drag keeps one horizontal real tab and drops it at the invisible reserved slot', async ({
  page,
}) => {
  await mountStrip(page, { viewport: 900, zoom: 1, reduced: false });
  const active = page.locator('[data-workspace-tab="active"]');
  const activeTab = active.locator('[role="tab"]');
  const origin = await box(active);
  const tabBounds = await box(activeTab);
  const loading = await box(page.locator('[data-workspace-tab="loading"]'));
  const startX = tabBounds.x + 28;
  const dragX = loading.x + loading.width + 4;
  const pointerY = origin.y + origin.height / 2;
  const strip = page.locator('[data-workspace-tab-strip]');
  const close = active.locator('[data-workspace-tab-close]');
  const mask = page.locator('[data-active-tab-border-mask]');
  const titlebar = page.locator('.window-title-bar');

  await expect(activeTab).toHaveCSS('cursor', 'pointer');
  await expect(close).toHaveCSS('cursor', 'pointer');

  await page.mouse.move(startX, pointerY);
  await page.mouse.down();
  await expect(activeTab).toHaveCSS('cursor', 'pointer');
  const dragOver = async (x: number) => page.mouse.move(x, pointerY + 200, { steps: 4 });

  for (const pointerX of [startX + 44, startX - 16, dragX]) {
    await dragOver(pointerX);
    const tracked = await box(active);
    const titlebarBounds = await box(titlebar);
    expect(tracked.x).toBeCloseTo(origin.x + pointerX - startX, 1);
    expect(tracked.y).toBeCloseTo(origin.y - 2, 1);
    await expect(mask).toHaveAttribute('data-tracking', 'true');
    expect(
      await mask.evaluate((node) => ({
        left: Number.parseFloat((node as HTMLElement).style.left),
        transition: (node as HTMLElement).style.transition,
        width: Number.parseFloat((node as HTMLElement).style.width),
      })),
    ).toEqual({
      left: expect.closeTo(tracked.x - titlebarBounds.x - 6, 1),
      transition: 'none',
      width: expect.closeTo(tracked.width + 13, 1),
    });
  }

  const reservedSlot = page.locator('[data-workspace-tab-placeholder="active"]');
  await expect(reservedSlot).toHaveCount(1);
  await expect(reservedSlot).toBeHidden();
  await expect(reservedSlot).toHaveCSS('visibility', 'hidden');
  await expect(strip).toHaveCSS('cursor', 'grabbing');
  await expect(active).toHaveCSS('position', 'fixed');
  await expect(active).toHaveCSS('border-bottom-width', '0px');
  await expect(active).toHaveCSS('box-shadow', 'none');
  const dragged = await box(active);
  const [leadingFlare, trailingFlare] = await Promise.all([
    box(active.locator('[data-workspace-tab-leading-flare]')),
    box(active.locator('[data-workspace-tab-trailing-flare]')),
  ]);
  const proposed = await box(reservedSlot);
  expect({ width: proposed.width, height: proposed.height }).toEqual({
    width: origin.width,
    height: origin.height,
  });
  expect(
    await reservedSlot.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundColor: style.backgroundColor,
        borderWidth: style.borderWidth,
        outlineStyle: style.outlineStyle,
      };
    }),
  ).toEqual({
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderWidth: '0px',
    outlineStyle: 'none',
  });
  expect(dragged.x).toBeCloseTo(origin.x + dragX - startX, 1);
  expect(dragged.y).toBeCloseTo(origin.y - 2, 1);
  expect(leadingFlare.y + leadingFlare.height).toBeCloseTo(origin.y + origin.height, 1);
  expect(trailingFlare.y + trailingFlare.height).toBeCloseTo(origin.y + origin.height, 1);
  expect(
    await page
      .locator('[data-workspace-tab-motion]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-workspace-tab-motion'))),
  ).toEqual(['inactive', 'plain', 'loading', 'active']);
  await expect(page.locator('[data-workspace-stack-preview]')).toHaveCount(0);

  await page.mouse.up();
  await expect.poll(() => mask.getAttribute('data-tracking')).toBe('false');
  await expect
    .poll(() => mask.evaluate((node) => (node as HTMLElement).style.transition))
    .toContain('left 200ms');

  expect(
    await page.evaluate(() =>
      (
        globalThis as typeof globalThis & {
          __workspaceTabScenario: { actions: Array<{ type: string; payload: unknown }> };
        }
      ).__workspaceTabScenario.actions
        .filter((action) => action.type === 'move')
        .map((action) => action.payload),
    ),
  ).toEqual([['active', 'loading', 'after']]);
  expect(
    await page.evaluate(
      () =>
        (globalThis as typeof globalThis & { __workspaceTabScenario: { currentId: string } })
          .__workspaceTabScenario.currentId,
    ),
  ).toBe('active');

  await expect(reservedSlot).toHaveCount(0);
  await expect(strip).toHaveCSS('cursor', 'auto');
  await expect(activeTab).toHaveCSS('cursor', 'pointer');
  await expect(close).toHaveCSS('cursor', 'pointer');
  await expect(active).toHaveCSS('position', 'relative');
  await expect(active).toHaveCSS('z-index', 'auto');
  await expect(active).toHaveCSS('border-bottom-width', '0px');
  await expect(active).toHaveCSS('box-shadow', 'none');
  const dropped = await box(active);
  expect(dropped.x).toBeCloseTo(proposed.x, 1);
  expect(dropped.x).not.toBeCloseTo(origin.x, 1);
});
