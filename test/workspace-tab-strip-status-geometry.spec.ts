import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import { viteHarnessCacheDir } from './vite-harness-cache.mjs';
import { prepareRootHarnessModules } from './root-harness-import';

let server: ViteDevServer;
let baseUrl: string;

const virtualPrefix = '\0workspace-tab-strip:';
const virtualModules: Record<string, string> = {
  '$app/navigation': 'export const goto = async () => {};',
  // This geometry fixture models a renderer without an attached hardware console.
  '$features/hardware-console/device/connection-status': `
    export const microConnectedReadable = () => ({ subscribe(run) { run(false); return () => {}; } });`,
  '$store/renderer/slices/hardware-console/hardware-console-selectors': `
    const readable = (value) => ({ subscribe(run) { run(value); return () => {}; } });
    export const selectWorkspacePinnedKeySlot = Object.assign(() => readable(null), { select: () => null });
    export const selectWorkspaceResolvedKeySlot = Object.assign(() => readable(null), { select: () => null });
    export const selectHardwareConsoleKeySlots = Object.assign(() => readable([]), { select: () => [] });`,
  '$features/agent/services/active-streams-tracker': `
    export const activeStreamsTracker = {
      startPolling() {}, subscribe() { return () => {}; },
      getStreamingAgentIdsForWorkspace() { return []; },
    };`,
  '$features/workspace/utils/empty-window-destination': `
    export const resolveEmptyWindowDestination = () => '/';`,
  '$lib/components/ui/tooltip': `
    import Tooltip from '/src/lib/components/layout/__tests__/mocks/MockWorkspaceTooltipRich.svelte';
    export const TooltipRich = Tooltip;
    export const TooltipShortcut = Tooltip;
    export { Tooltip };`,
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
    export const selectWorkspaceTabOrder = Object.assign(
      () => readable(() => globalThis.__workspaceTabScenario.tabOrder),
      { select: () => globalThis.__workspaceTabScenario.tabOrder },
    );`,
  '$store/renderer/slices/workspace/workspace-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectWorkspaceById = Object.assign(
      (id) => readable(() => globalThis.__workspaceTabScenario.workspaces.find((w) => w.id === id)),
      { select: (_state, id) => globalThis.__workspaceTabScenario.workspaces.find((w) => w.id === id) },
    );
    export const selectWorkspaceItems = Object.assign(
      () => readable(() => globalThis.__workspaceTabScenario.workspaces),
      { select: () => globalThis.__workspaceTabScenario.workspaces },
    );`,
  '$store/renderer/slices/presence/presence-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectPresenceRosters = () => readable(() => ({}));
    export const selectPresenceMembers = () => readable(() => ({}));
    export const selectPresenceOwnPrincipalId = () => readable(() => null);
    export const selectWorkspacePresencePeople = Object.assign(
      () => readable(() => []),
      { select: () => [] },
    );`,
  '$store/renderer/slices/hud/hud-selectors': `
    const readable = (read) => ({ subscribe(run) { run(read()); return () => {}; } });
    export const selectWorkspaceTabStatuses = () =>
      readable(() => globalThis.__workspaceTabScenario.statuses);`,
  '$store/renderer/store': `
    export const store = {
      dispatch(action) { globalThis.__workspaceTabScenario.actions.push(action); },
      get state() { return {}; },
      getReadableState() { return { subscribe(run) { run({}); return () => {}; } }; },
    };`,
  '@fortawesome/free-solid-svg-icons': `
    export const faArrowRight = { iconName: 'arrow-right' };
    export const faCheck = { iconName: 'check' };
    export const faChevronRight = { iconName: 'chevron-right' };
    export const faCircleCheck = { iconName: 'circle-check' };
    export const faCircleQuestion = { iconName: 'circle-question' };
    export const faClock = { iconName: 'clock' };
    export const faCodeMerge = { iconName: 'code-merge' };
    export const faCodePullRequest = { iconName: 'code-pull-request' };
    export const faEllipsis = { iconName: 'ellipsis' };
    export const faHourglassHalf = { iconName: 'hourglass-half' };
    export const faLayerGroup = { iconName: 'layer-group' };
    export const faTriangleExclamation = { iconName: 'triangle-exclamation' };
    export const faXmark = { iconName: 'xmark' };`,
};

function geometryStubs(): Plugin {
  const componentPath = 'src/lib/components/layout/WorkspaceTabStrip.svelte';
  const sourceRef = process.env.WORKSPACE_TAB_STRIP_REF;
  const baselineSource = sourceRef
    ? execFileSync('git', ['show', `${sourceRef}:${componentPath}`], { encoding: 'utf8' })
    : null;
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
      // Let the initial scan discover icon dependencies before the browser mounts.
      if (source === '@fortawesome/free-solid-svg-icons')
        return resolve(process.cwd(), 'src/lib/icons/phosphor-icons.ts');
      // Vite scans .svelte imports from disk, even when resolved to virtual JS (#4624).
      if (
        source === '$lib/components/workspace/WorkspaceHoverCard.svelte' ||
        source === resolve(process.cwd(), 'src/lib/components/workspace/WorkspaceHoverCard.svelte')
      ) {
        return resolve(
          process.cwd(),
          'src/lib/components/layout/__tests__/mocks/MockWorkspaceHoverCard.svelte',
        );
      }
      const canonical = canonicalSource(source);
      if (canonical) return virtualPrefix + canonical + '.js';
      return null;
    },
    load(id) {
      if (baselineSource && id === resolve(process.cwd(), componentPath)) return baselineSource;
      return id.startsWith(virtualPrefix)
        ? virtualModules[id.slice(virtualPrefix.length, -3)]
        : null;
    },
  };
}

test.beforeAll(async ({}, workerInfo) => {
  test.setTimeout(120_000);
  const cacheDir = viteHarnessCacheDir('workspace-tab-strip-status-geometry', {
    workerIndex: workerInfo.workerIndex,
  });
  console.log(
    'HARNESS_CACHE ' +
      JSON.stringify({
        name: 'workspace-tab-strip-status-geometry',
        worker: workerInfo.workerIndex,
        cacheDir,
        populated: existsSync(resolve(cacheDir, 'deps/_metadata.json')),
      }),
  );
  server = await createServer({
    configFile: false,
    root: process.cwd(),
    cacheDir,
    optimizeDeps: { entries: ['src/lib/components/layout/WorkspaceTabStrip.svelte'] },
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
  },
) {
  await page.setViewportSize({ width: options.viewport, height: 360 });
  await page.emulateMedia({ reducedMotion: options.reduced ? 'reduce' : 'no-preference' });
  await prepareRootHarnessModules(page, baseUrl, [
    '/@id/svelte',
    '/src/lib/components/layout/WorkspaceTabStrip.svelte',
  ]);
  await page.addStyleTag({ url: `${baseUrl}src/app.css` });
  await page.addStyleTag({ content: 'body { margin: 0; overflow: hidden; }' });
  await page.evaluate(async ({ zoom }) => {
    Object.assign(globalThis, { process: { env: { NODE_ENV: 'test' } } });
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
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
      return {
        agentCount: 1,
        categories: items,
        visibleCategories: items,
        hiddenCategoryCount: 0,
      };
    }
    const [{ mount, tick }, { default: Strip }] = await Promise.all([
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
        mask.style.left = bounds ? `${bounds.left}px` : '';
        mask.style.width = bounds ? `${bounds.width}px` : '';
      },
      onActiveTabTrackingChange(tracking: boolean) {
        mask.dataset.tracking = String(tracking);
        mask.style.transition = tracking
          ? 'none'
          : 'left 200ms cubic-bezier(0.215, 0.61, 0.355, 1)';
      },
    };
    // Match WindowTitleBar's flex controls: shrinking bounds the scroll viewport.
    target.style.cssText = `position:relative;display:flex;min-width:0;align-items:center;width:100%;padding:24px;zoom:${zoom};`;
    mount(Strip, { target, props: stripProps });
    await tick();
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
  }, options);
}

async function box(locator: Locator) {
  const value = await locator.boundingBox();
  expect(value).not.toBeNull();
  return value!;
}

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
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x + 0.5);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(closeBox.x + 0.5);
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(activeBox.x + activeBox.width + 0.5);
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
    await expect(inactiveStatus.locator('[data-workspace-status]')).toHaveCount(1);

    await expect(plain.locator('[data-workspace-status="idle"]')).toHaveCount(1);
    const [plainTitleBox, plainCloseBox] = await Promise.all([
      box(plain.locator('[data-workspace-tab-title]')),
      box(plain.locator('[data-workspace-tab-close]')),
    ]);
    expect(plainTitleBox.x + plainTitleBox.width).toBeLessThanOrEqual(plainCloseBox.x + 0.5);

    await expect(loading).toHaveAttribute('data-workspace-tab-loading', 'true');
    await expect(loading.locator('[data-workspace-tab-status-cluster]')).toHaveCount(0);
    const [loadingIndicatorBox, loadingCloseBox] = await Promise.all([
      box(loading.locator('[data-workspace-tab-loading-indicator]')),
      box(loading.locator('[data-workspace-tab-close]')),
    ]);
    expect(loadingIndicatorBox.x + loadingIndicatorBox.width).toBeLessThan(loadingCloseBox.x);

    if (options.reduced) {
      const transitionSeconds = await active.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).transitionDuration),
      );
      expect(transitionSeconds).toBeLessThanOrEqual(0.00001);
    }
  }
});

test('focus and close hover keep tab controls separated', async ({ page }) => {
  await mountStrip(page, { viewport: 900, zoom: 1, reduced: true });
  const active = page.locator('[data-workspace-tab="active"]');
  const title = active.locator('[data-workspace-tab-title]');
  const status = active.locator('[data-workspace-tab-status-cluster]');
  const close = active.locator('[data-workspace-tab-close]');
  const expectSeparated = async () => {
    const [titleBox, statusBox, closeBox] = await Promise.all([
      box(title),
      box(status),
      box(close),
    ]);
    expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(statusBox.x + 0.5);
    expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(closeBox.x + 0.5);
  };

  const tab = active.locator('[role="tab"]');
  await tab.focus();
  await expect(tab).toBeFocused();
  await close.hover();
  await expectSeparated();
});
