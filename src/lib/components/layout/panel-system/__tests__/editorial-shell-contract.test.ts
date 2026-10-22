// @verify-changed-triggers: ../Panel.svelte, ../PanelContainer.svelte, ../PanelLayout.svelte,
//   ../PanelSplitHandle.svelte, ../PanelTabBar.svelte,
//   ../../WindowTitleBar.svelte, ../../WorkspaceTabStrip.svelte,
//   ../../sidebar-nav/SidebarNav.svelte,
//   ../../../workspace/WorkspaceLayout.svelte, ../../../workspace/WorkspaceSidebarHeader.svelte,
//   ../../../workspace/MultiSelectTabbedSidebar.svelte,
//   ../../../workspace/multi-select-sidebar-tabs.ts,
//   ../../../workspace/sidebar/SidebarHeaderAction.svelte,
//   ../../../workspace/sidebar/WorkspaceProgressCard.svelte,
//   ../../../terminal/QuakeTerminalOverlay.svelte, ../../../../../app.css, ../../../../../app.html,
//   ../../../../../routes/(app)/+layout.svelte, ../../../../../routes/(app)/app-layout.css,
//   ../../../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte,
//   ../../../../../routes/(app)/workspace/[id]/composables/use-panel-shortcuts.svelte.ts

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('editorial workspace shell presentation contract', () => {
  it('keeps responsive workspace insets and scrolls horizontally when panels overflow', () => {
    const layout = source('../PanelLayout.svelte');

    expect(layout).toContain(
      "contained ? 'overflow-hidden py-2 px-2' : 'overflow-x-auto py-2 pr-2 sm:py-3 sm:pr-3'",
    );
    expect(layout).toContain(
      "use:scrollFade={{ axis: 'x', fadeSize: contained ? 0 : 24, enabled: active }}",
    );
    expect(layout).toContain('data-testid="panel-workspace-inset"');
    expect(layout).toContain('flex h-full w-max min-w-full');
    expect(layout).not.toMatch(/\bpr-0\b/);
  });

  it('uses one clipped borderless shell with state-specific panel surfaces', () => {
    const panel = source('../Panel.svelte');
    const container = source('../PanelContainer.svelte');

    expect(panel).toContain('overflow-hidden rounded-(--panel-shell-radius) text-foreground');
    expect(panel).not.toContain('rounded-lg border border-border');
    expect(panel).toContain('class:bg-sidebar={panel.tabs.length === 0}');
    expect(panel).toContain('class:bg-background={panel.tabs.length > 0}');
    expect(panel).toContain('data-empty-panel-surface={');
    expect(container).toContain('class="h-full w-full min-h-0 min-w-0"');
    expect(container).toContain(
      'class="h-full w-full bg-background text-foreground" data-missing-panel-surface',
    );
    expect(panel).toContain('width: 100%');
    expect(panel).toContain('min-width: 0');
    expect(panel).not.toContain('min-width: 30em');
    expect(panel).toContain('box-shadow: var(--elevation-raised)');
    // Focus-invariant border and child geometry are exercised in panel-shell-corners.ct.spec.ts.
    expect(panel).toMatch(/\.panel\[data-empty-panel-shell='true'\]\s*\{\s*box-shadow: none;/);
    expect(panel).not.toMatch(/\.panel\[data-empty-panel-shell='true'\]\s*\{\s*border-width: 0;/);
    expect(panel).not.toContain('.panel:focus-visible');
    expect(panel).not.toContain('.panel:has(:focus-visible)');
    expect(panel).not.toContain('.panel.focused');
    expect(panel).not.toContain("isFocused && 'focused'");
    expect(panel).toContain('box-sizing: border-box;\n    border: 1px solid transparent;');
    expect(panel).toContain(
      ".panel[data-focus-border-visible='true'] {\n    border-color: hsl(var(--border));",
    );
    expect(panel).toContain(
      "@media (forced-colors: active) {\n    .panel[data-focus-border-visible='true'] {\n      border-color: Highlight;",
    );
    expect(panel).toContain('data-focused={isFocused}');
    expect(panel).toContain('data-zoomed={isZoomed}');
  });

  it('reserves exact semantic gutters without shrinking resize targets', () => {
    const container = source('../PanelContainer.svelte');
    const handle = source('../PanelSplitHandle.svelte');

    expect(container).toContain('gap: 0');
    expect(container).toContain('width: var(--space-2)');
    expect(container).toContain('height: var(--space-2)');
    expect(container).toContain(
      "data-split-gutter={item.type === 'gutter' ? node.direction : undefined}",
    );
    expect(container).not.toContain('min-width: 30em');
    expect(container).not.toContain('min-width: 30rem');
    expect(container).toContain('.panel-split-container {');
    expect(container).toContain('min-width: 0');
    expect(container).toContain('overflow: hidden');
    expect(handle).toContain('width: 16px');
    expect(handle).toContain('height: 16px');
  });

  // Content-aware header/menu composition is exercised at runtime in
  // panel-header-actions-menu.test.ts, including absent content sections.

  it('limits direct manipulation to the horizontal panel stack', () => {
    const panel = source('../Panel.svelte');
    const layout = source('../PanelLayout.svelte');

    expect(panel).toContain('Tabless panels only split along the horizontal stack.');
    expect(layout).toContain("if (direction !== 'horizontal') return;");
    expect(layout).toMatch(
      /moveTabToSplitLevel\(\s*draggedPane\.tabId,\s*draggedPane\.panelId,\s*\[\],\s*placement\.position,\s*'horizontal',\s*\)/,
    );
  });

  it('reserves browser-style tab chords for global workspace tabs', () => {
    const layout = source('../PanelLayout.svelte');
    const routeShortcuts = source(
      '../../../../../routes/(app)/workspace/[id]/composables/use-panel-shortcuts.svelte.ts',
    );

    expect(layout).not.toContain("e.key === 'w' || e.key === 'W'");
    expect(layout).not.toContain("e.key === 't' || e.key === 'T'");
    expect(layout).not.toContain("e.key >= '1' && e.key <= '9'");
    expect(routeShortcuts).not.toContain("event.key === '1' && !event.shiftKey");
  });

  it('uses a two-zone titlebar without a competing centered search field', () => {
    const titlebar = source('../../WindowTitleBar.svelte');
    const tabs = source('../../WorkspaceTabStrip.svelte');
    const nav = source('../../sidebar-nav/SidebarNav.svelte');
    const workspaceHeader = source('../../../workspace/WorkspaceSidebarHeader.svelte');
    const progressCard = source('../../../workspace/sidebar/WorkspaceProgressCard.svelte');

    expect(titlebar).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(titlebar).toContain('data-titlebar-drag-handle');
    expect(titlebar).toContain('data-titlebar-left-drag-handle');
    expect(titlebar).toContain('titlebar-left-drag-handle shrink-0 self-stretch');
    expect(titlebar).toContain('data-titlebar-fixed-controls');
    expect(titlebar).toContain('class="flex min-w-0 self-end items-center gap-1');
    expect(titlebar).toContain('data-titlebar-workspace-controls');
    expect(titlebar).toContain('--titlebar-control-shift: 0px');
    expect(titlebar).toContain('--titlebar-control-shift: 8px');
    expect(titlebar).toContain('padding-left: 80px');
    expect(titlebar).toContain('width: calc(16px - var(--titlebar-control-shift))');
    expect(titlebar).toContain('padding-right: var(--titlebar-control-shift)');
    expect(titlebar.indexOf('<SidebarNav />')).toBeLessThan(titlebar.indexOf('<WorkspaceTabStrip'));
    expect(titlebar).toContain('style:left={`${activeTabBounds.left}px`}');
    expect(titlebar).toContain('style:width={`${activeTabBounds.width}px`}');
    expect(titlebar).toContain('.titlebar-drag-handle');
    expect(titlebar).toContain('.titlebar-left-drag-surface');
    expect(titlebar).toContain('.titlebar-left-drag-handle');
    expect(titlebar).not.toContain('style="-webkit-app-region: no-drag"');
    expect(titlebar).toContain('<WorkspaceRepoLauncher />');
    expect(titlebar).toContain('data-titlebar-settings');
    expect(titlebar).toContain('<IntentNavigationIcon name="settings" size={16}');
    expect(titlebar).not.toContain('<PanelLayoutControls');
    expect(titlebar).not.toContain('aria-label="Toggle sidebar"');
    expect(titlebar).not.toContain('mx-0.5 h-4 w-px shrink-0 bg-border/70');
    // Flex shrinking bounds narrow layouts without a percentage cap feeding
    // the overflow-dependent margin back into the intrinsic parent width.
    // The drag-region and layout-stability CTs cover this across launcher states.
    expect(tabs).toContain('w-fit min-w-0 items-center');
    expect(tabs).not.toContain('max-w-[100%]');
    expect(tabs).toContain('use:reportActiveTabBounds={isCurrent}');
    expect(titlebar).toContain('data-active-tab-border-mask');
    expect(nav).not.toContain('faBell');
    expect(nav).not.toContain("id: 'settings'");
    expect(nav).toContain('data-titlebar-spaces-control');
    expect(titlebar).not.toContain('ChiefTrigger');
    expect(workspaceHeader).toContain('label: m.ui_sidebar_toggle_label()');
    expect(workspaceHeader).toContain('appStore.dispatch(toggleSidebar())');
    expect(progressCard).toContain('label: m.ui_sidebar_toggle_label()');
    expect(progressCard).toContain('const additionalActions: MenuAction[] = $derived([');
    expect(progressCard).toContain('sidebarToggleAction,');
    expect(progressCard).toContain('sidebarSideAction,');
    expect(progressCard).toContain('...(transferAction ? [transferAction] : []),');
    expect(progressCard).toContain('{additionalActions}');
    expect(titlebar).not.toContain('class="search-bar"');
  });

  it('anchors native window dragging to the untransformed titlebar wrapper', () => {
    const titlebar = source('../../WindowTitleBar.svelte');

    expect(titlebar).toMatch(/\.window-title-bar-wrapper\s*\{[^}]*-webkit-app-region:\s*drag;/s);
    expect(titlebar).toContain('style:transform="scale({$counterScale})"');
  });

  it('consolidates Chief and Spaces in the title bar and removes the former workspace notch', () => {
    const appLayout = source('../../../../../routes/(app)/+layout.svelte');
    const navigation = source('../../sidebar-nav/SidebarNav.svelte');

    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 bg-transparent pb-2 pl-2');
    expect(appLayout).toContain('workspace-frame relative');
    expect(appLayout).not.toContain('<ChiefNotch />');
    expect(appLayout).not.toContain('clip-path: var(--workspace-clip');
    expect(navigation).not.toContain('aria-haspopup');
    expect(navigation).not.toContain('aria-expanded');
    expect(navigation).not.toContain('aria-controls');
    expect(navigation).not.toContain('SidebarNavHoverCard');
    expect(appLayout).toContain('class="workspace-main flex');
  });

  it('owns shell, page, and sidebar surfaces with resolved app theme tokens', () => {
    const appCss = source('../../../../../app.css');
    const appHtml = source('../../../../../app.html');
    const appLayout = source('../../../../../routes/(app)/+layout.svelte');
    const appLayoutCss = source('../../../../../routes/(app)/app-layout.css');

    expect(appCss).toMatch(/html,\s*body\s*{[^}]*background-color:\s*transparent;/s);
    expect(appCss).toMatch(/#app\s*{[^}]*background-color:\s*transparent;/s);
    expect(appHtml).toMatch(/html,\s*body,\s*#app\s*{\s*background:\s*transparent;/s);
    expect(appHtml).toMatch(/#splash\s*{[^}]*background:\s*transparent;/s);
    expect(appLayout).toContain('overflow-hidden bg-transparent text-foreground');
    expect(appLayout.match(/panel-layout-container/g)).toHaveLength(1);
    expect(appLayout).not.toContain('background-color: hsl(var(--background) /');
    expect(appLayoutCss).toMatch(
      /\.panel-layout-container\s*{\s*background-color:\s*hsl\(var\(--background\) \/ 0\.35\);\s*}/,
    );
    expect(appLayoutCss).toMatch(
      /:where\(\.dark\) \.panel-layout-container\s*{\s*background-color:\s*transparent;\s*}/,
    );
    expect(appLayout).toContain('class="workspace-main flex');
    expect(appLayout).toContain(
      'const shellTransparencyEnabled$ = selectShellTransparencyEnabled()',
    );
    expect(appLayout).toContain('data-shell-opaque={!$shellTransparencyEnabled$ || undefined}');
    expect(appLayoutCss).toMatch(
      /\.panel-layout-container\[data-shell-opaque\],[\s\S]*background-color:\s*hsl\(var\(--background\)\);/,
    );
    expect(appLayout).toContain('rounded-xl bg-sidebar border border-border shadow-sm');
    expect(appLayout).not.toContain('backdrop-filter:');
  });

  it('orders workspace identity, progress, and status like the reference hierarchy', () => {
    const progressCard = source('../../../workspace/sidebar/WorkspaceProgressCard.svelte');
    const fullMode = progressCard.slice(progressCard.indexOf('data-workspace-header-actions'));
    const repository = fullMode.indexOf('<!-- repository and branch metadata -->');
    const progress = fullMode.indexOf('data-workspace-task-progress');
    const status = fullMode.indexOf('<!-- Status follows identity and progress');

    expect(repository).toBeGreaterThan(-1);
    expect(progress).toBeGreaterThan(repository);
    expect(status).toBeGreaterThan(progress);
    expect(fullMode).toContain('{#if showFlameGraph}');
  });
});
