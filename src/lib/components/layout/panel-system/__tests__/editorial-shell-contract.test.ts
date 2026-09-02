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

  it('keeps compact content full-width while the persistent sidebar overlays it', () => {
    const workspace = source('../../../workspace/WorkspaceLayout.svelte');

    expect(workspace).toContain('workspace-sidebar-panel workspace-sidebar-{sidebarSide}');
    expect(workspace).toContain('@media (max-width: 639px)');
    expect(workspace).toContain('.upper-area :global(.workspace-sidebar-panel)');
    expect(workspace).toContain('position: absolute');
  });

  it('uses one clipped borderless shell with state-specific panel surfaces', () => {
    const panel = source('../Panel.svelte');
    const container = source('../PanelContainer.svelte');

    expect(panel).toContain('overflow-hidden rounded-(--panel-shell-radius) text-foreground');
    expect(panel).toContain('--panel-shell-radius: var(--radius-large);');
    expect(panel).not.toContain('rounded-lg border border-border');
    expect(panel).toContain(
      'class:bg-sidebar={panel.pristine === true && panel.tabs.length === 0}',
    );
    expect(panel).toContain(
      'class:bg-background={panel.pristine !== true || panel.tabs.length > 0}',
    );
    expect(panel).toContain('data-empty-panel-surface={');
    expect(container).toContain('class="h-full w-full min-h-0 min-w-0"');
    expect(container).toContain(
      'class="h-full w-full bg-background text-foreground" data-missing-panel-surface',
    );
    expect(panel).toContain('width: 100%');
    expect(panel).toContain('min-width: 0');
    expect(panel).not.toContain('min-width: 30em');
    expect(panel).toContain('box-shadow: var(--elevation-raised)');
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

  it('renders one content-aware header per panel without the legacy tab strip', () => {
    const tabBar = source('../PanelTabBar.svelte');

    expect(tabBar).not.toContain('border-b border-border');
    expect(tabBar).toContain('h-[var(--panel-header-height)] bg-card');
    expect(tabBar).toContain('items-center bg-sidebar pr-2.5');
    expect(tabBar).toContain('showTabStrip = false');
    expect(tabBar).toContain("!showTabStrip && 'hidden'");
    expect(tabBar).toContain('data-panel-tab-bar');
    expect(tabBar).toContain('data-panel-tabless-header');
    expect(tabBar).toContain('data-panel-content-header');
    expect(tabBar).toContain('m.layout_panelTabBar_closePane_ariaLabel()');
    expect(tabBar).toContain("{#snippet panelActionsDropdown(location: 'tabBar' | 'compact')}");
    expect(tabBar).toContain('bind:open={panelActionsMenuOpen[location]}');
    expect(tabBar).toContain("{@render panelActionsDropdown('tabBar')}");
    expect(tabBar).toContain("{@render panelActionsDropdown('compact')}");
    expect(tabBar).toContain('{#snippet panelCloseButton(tab: PanelTab | null = null)}');
    expect(tabBar).toContain('data-testid="panel-close-button"');
    expect(tabBar).toContain('data-panel-actions-section="display"');
    expect(tabBar).toContain('data-panel-actions-section="actions"');
    expect(tabBar).toContain('m.layout_panelTabBar_displaySection_label()');
    expect(tabBar).toContain('m.layout_panelTabBar_actionsSection_label()');
    expect(tabBar).toContain('{@render contentActions?.display?.()}');
    expect(tabBar).toContain('{@render contentActions?.actions?.()}');
    expect(tabBar).not.toContain('{@render contentActions()}');
    expect(tabBar).toContain('<Menu.Separator />');
    expect(tabBar).toContain('<Menu.CommandItem');
    expect(tabBar).not.toContain('color-mix');
  });

  it('limits direct manipulation and presets to the horizontal panel stack', () => {
    const panel = source('../Panel.svelte');
    const layout = source('../PanelLayout.svelte');
    const presets = source('../LayoutPresetDropdown.svelte');

    expect(panel).toContain('Tabless panels only split along the horizontal stack.');
    expect(layout).toContain("if (direction !== 'horizontal') return;");
    expect(layout).toMatch(
      /moveTabToSplitLevel\(\s*draggedPane\.tabId,\s*draggedPane\.panelId,\s*\[\],\s*placement\.position,\s*'horizontal',\s*\)/,
    );
    expect(presets).not.toContain("id: 'split-vertical'");
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

  it('uses equal muted launchers with direct item actions that disappear when expanded', () => {
    const workspace = source('../../../workspace/WorkspaceLayout.svelte');
    const sidebar = source('../../../workspace/MultiSelectTabbedSidebar.svelte');
    const headerAction = source('../../../workspace/sidebar/SidebarHeaderAction.svelte');
    const tabDefinitions = source('../../../workspace/multi-select-sidebar-tabs.ts');
    const launcherMarkup = sidebar.slice(sidebar.indexOf('<!-- Lightweight launchers'));

    expect(workspace).toContain('sidebarMinWidth = 280');
    expect(workspace).toContain('sidebarDefaultWidth = 360');
    expect(workspace).toContain('sidebarPercentageWeight = 0');
    expect(tabDefinitions).toContain('m.workspace_multiSelectSidebar_contextTab_label()');
    expect(sidebar).toContain('grid h-56 w-full auto-rows-fr grid-cols-2 gap-3');
    expect(launcherMarkup).toContain('h-full min-h-0');
    expect(launcherMarkup).toContain(
      'rounded-lg border border-border bg-sidebar p-2 text-foreground',
    );
    expect(sidebar).toContain('<AgentAvatar');
    expect(sidebar).toContain('data-sidebar-agent={agent.id}');
    expect(launcherMarkup).toContain('itemContent={launcherAgentAvatar}');
    expect(launcherMarkup).toContain('data-sidebar-context={note.id}');
    expect(launcherMarkup).toContain('data-sidebar-changes-resource');
    expect(launcherMarkup).not.toContain('data-sidebar-change=');
    expect(launcherMarkup).not.toContain('content={`${tab.label}:');
    expect(launcherMarkup).toContain('data-files-open-in');
    expect(launcherMarkup).not.toContain('faFolderTree');
    expect(sidebar).toContain('grid-rows-[minmax(0,1fr)_232px]');
    expect(sidebar).toContain('grid-rows-[minmax(0,1fr)_0px]');
    expect(sidebar).toContain('{#if isLauncherOverview}');
    expect(sidebar).toContain('label={m.ui_tab_close_ariaLabel()}');
    expect(headerAction).toContain('data-sidebar-close');
    expect(headerAction).toContain('hover:bg-muted/50!');
    expect(sidebar).toContain('sidebar-expanded-card relative z-10 flex');
    expect(sidebar).toContain('rounded-lg border border-border bg-sidebar');
    expect(sidebar).not.toContain('.sidebar-expanded-card :global(*)');
    expect(sidebar).not.toContain('view-transition-name: sidebar-section');
    expect(sidebar).toContain('in:cardMorph|global');
    expect(sidebar).toContain('out:cardMorph|global');
    expect(sidebar).not.toContain('h-16 grid-cols-4 gap-1.5');
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
    expect(titlebar).toContain('titlebar-fixed-controls flex min-w-0 items-center gap-1');
    expect(titlebar).toContain('data-titlebar-fixed-controls');
    expect(titlebar).toContain('class="flex min-w-0 self-end items-center gap-1');
    expect(titlebar).toContain('data-titlebar-workspace-controls');
    expect(titlebar).toContain('--titlebar-control-shift: 0px');
    expect(titlebar).toContain('--titlebar-control-shift: 8px');
    // Native-control clearance is measured against WindowTitleBar in
    // test/titlebar-workspace-controls.spec.ts, not inferred from CSS spelling.
    expect(titlebar).toContain('width: calc(16px - var(--titlebar-control-shift))');
    expect(titlebar).toContain('padding-right: var(--titlebar-control-shift)');
    expect(titlebar.indexOf('<SidebarNav />')).toBeLessThan(titlebar.indexOf('<WorkspaceTabStrip'));
    expect(titlebar).toContain('style:margin-left={`${panelOffset}px`}');
    expect(titlebar).toContain('activeTabBounds.left - WORKSPACE_TAB_FLARE_RADIUS_PX');
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
    expect(tabs).toContain('w-fit min-w-0 max-w-[100%]');
    expect(tabs).toContain('use:reportActiveTabBounds={isCurrent}');
    expect(tabs).toContain('onActiveTabBoundsChange?.({');
    expect(titlebar).toContain('data-active-tab-border-mask');
    expect(titlebar).toContain('absolute -bottom-px z-[60] h-px bg-sidebar');
    expect(nav).not.toContain('faBell');
    expect(nav).not.toContain("id: 'settings'");
    expect(nav).toContain('data-titlebar-spaces-control');
    expect(nav).toContain('name="dandelion"');
    expect(nav).not.toContain('name="spaces"');
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
    const sidebarPanel = source('../../sidebar-nav/SidebarPanel.svelte');

    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 bg-transparent pb-2 pl-2');
    expect(appLayout).toContain('workspace-frame relative');
    expect(appLayout).not.toContain('<ChiefNotch />');
    expect(appLayout).not.toContain('clip-path: var(--workspace-clip');
    expect(navigation).toContain('aria-label={m.layout_titleBar_toggleSidebar_ariaLabel()}');
    expect(navigation).toContain('aria-pressed={active}');
    expect(navigation).not.toContain('aria-haspopup');
    expect(navigation).not.toContain('aria-expanded');
    expect(navigation).not.toContain('aria-controls');
    expect(navigation).not.toContain('SidebarNavHoverCard');
    expect(navigation).toContain('name="dandelion"');
    expect(appLayout).toContain('class="workspace-main flex');
    expect(sidebarPanel).toContain('data-panel-item={$panelItem$}');
    expect(sidebarPanel).not.toContain("$panelItem$ === 'chief' ? 'bg-background' : ''");
    // The panel stays mounted when closed and animates its width instead of
    // mounting/unmounting via a slide transition.
    expect(sidebarPanel).not.toContain("transition:slide={{ axis: 'x', duration: 200 }}");
    expect(sidebarPanel).toContain('data-panel-shell');
    expect(sidebarPanel).toContain('inert={!isOpen}');
  });

  it('owns shell, page, and sidebar surfaces with resolved app theme tokens', () => {
    const appCss = source('../../../../../app.css');
    const appHtml = source('../../../../../app.html');
    const appLayout = source('../../../../../routes/(app)/+layout.svelte');
    const appLayoutCss = source('../../../../../routes/(app)/app-layout.css');
    const sidebarPanel = source('../../sidebar-nav/SidebarPanel.svelte');

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
    expect(sidebarPanel).toContain('relative text-sidebar-foreground');
    expect(sidebarPanel).not.toContain('relative bg-sidebar text-sidebar-foreground');
    expect(appLayout).not.toContain('backdrop-filter:');
  });

  it('moves collapsed terminal controls into the workspace sidebar', () => {
    const sidebar = source('../../../workspace/MultiSelectTabbedSidebar.svelte');
    const dock = source('../../../workspace/WorkspaceTerminalDock.svelte');
    const terminal = source('../../../terminal/QuakeTerminalOverlay.svelte');
    const route = source('../../../../../routes/(app)/workspace/[id]/WorkspaceSurface.svelte');

    expect(sidebar).toContain('<WorkspaceTerminalDock');
    expect(sidebar).toContain("onExpand={() => handleTabClick('shell')}");
    expect(sidebar).toContain(
      "class={cn('relative flex h-full flex-col overflow-hidden bg-transparent', className)}",
    );
    expect(dock).toContain('{#each $terminals$.slice(0, 1) as terminal (terminal.id)}');
    expect(dock).toContain('data-dev-script-count');
    expect(dock).toContain('rounded-lg border border-border bg-sidebar px-3 text-foreground');
    expect(dock).toContain('border-0 bg-transparent p-0');
    expect(dock).not.toContain('faPlus');
    expect(dock).not.toContain('faChevron');
    expect(terminal).toContain('showDockWhenClosed || $isOpen');
    expect(route).toContain('showDockWhenClosed={false}');
  });

  it('renders a single content title instead of a category breadcrumb', () => {
    const tabBar = source('../PanelTabBar.svelte');

    expect(tabBar).toContain(
      'Single content title; type/category is conveyed by the content itself.',
    );
    expect(tabBar).not.toContain('<span>{categoryLabel}</span>');
    expect(tabBar).not.toContain('<span class="text-ghost text-xs">/</span>');
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
