import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('editorial workspace shell presentation contract', () => {
  it('keeps responsive workspace insets and scrolls horizontally when panels overflow', () => {
    const layout = source('../PanelLayout.svelte');

    expect(layout).toContain(
      "contained ? 'overflow-hidden p-2' : 'overflow-x-auto py-2 pr-2 sm:py-3 sm:pr-3'",
    );
    expect(layout).toContain('data-testid="panel-workspace-inset"');
    expect(layout).toContain('w-max min-w-full');
    expect(layout).not.toMatch(/\bpr-0\b/);
  });

  it('keeps compact content full-width while the persistent sidebar overlays it', () => {
    const workspace = source('../../../workspace/WorkspaceLayout.svelte');

    expect(workspace).toContain('workspace-sidebar-panel workspace-sidebar-{sidebarSide}');
    expect(workspace).toContain('@media (max-width: 639px)');
    expect(workspace).toContain('.upper-area :global(.workspace-sidebar-panel)');
    expect(workspace).toContain('position: absolute');
  });

  it('uses a clipped semantic card surface with a consistent light border', () => {
    const panel = source('../Panel.svelte');

    expect(panel).toContain('overflow-hidden rounded-lg border border-border/50 bg-card');
    expect(panel).toContain('width: 100%');
    expect(panel).toContain('min-width: 0');
    expect(panel).not.toContain('min-width: 30em');
    expect(panel).toContain('box-shadow: var(--elevation-raised)');
    expect(panel).not.toContain('.panel:focus-visible');
    expect(panel).not.toContain('.panel:has(:focus-visible)');
    expect(panel).not.toContain('.panel.focused');
    expect(panel).not.toContain("isFocused && 'focused'");
    expect(panel).not.toContain('outline:');
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
    expect(container).toContain('.panel-split-container.contained.horizontal > .panel-split-child');
    expect(container).not.toContain('min-width: 30em');
    expect(container).toContain('min-width: 30rem');
    expect(container).toContain('overflow: hidden');
    expect(handle).toContain('width: 16px');
    expect(handle).toContain('height: 16px');
  });

  it('renders one content-aware header per panel without the legacy tab strip', () => {
    const tabBar = source('../PanelTabBar.svelte');

    expect(tabBar).toContain('border-b border-border/50 bg-card');
    expect(tabBar).toContain('showTabStrip = false');
    expect(tabBar).toContain("!showTabStrip && 'hidden'");
    expect(tabBar).toContain('data-panel-tab-bar');
    expect(tabBar).toContain('data-panel-tabless-header');
    expect(tabBar).toContain('data-panel-content-header');
    expect(tabBar).toContain('aria-label="Close panel"');
    expect(tabBar).not.toContain('color-mix');
  });

  it('limits direct manipulation and presets to the horizontal panel stack', () => {
    const panel = source('../Panel.svelte');
    const layout = source('../PanelLayout.svelte');
    const presets = source('../LayoutPresetDropdown.svelte');

    expect(panel).toContain('Tabless panels only split along the horizontal stack.');
    expect(layout).toContain("handleSplitPanel(focusedId, 'horizontal')");
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
    const launcherMarkup = sidebar.slice(sidebar.indexOf('<!-- Lightweight launchers'));

    expect(workspace).toContain('sidebarMinWidth = 280');
    expect(workspace).toContain('sidebarDefaultWidth = 360');
    expect(sidebar).toContain("label: 'Context'");
    expect(sidebar).toContain('h-56 w-full auto-rows-fr grid-cols-2 gap-3');
    expect(launcherMarkup).toContain('h-full min-h-0');
    expect(launcherMarkup).toContain('rounded-lg bg-muted/35 p-3');
    expect(sidebar).toContain('<AuggieAvatar');
    expect(launcherMarkup).toContain('data-sidebar-agent={agent.id}');
    expect(launcherMarkup).toContain('data-sidebar-context={note.id}');
    expect(launcherMarkup).toContain('data-sidebar-change={changePath}');
    expect(launcherMarkup).not.toContain('content={`${tab.label}:');
    expect(launcherMarkup).toContain('data-files-open-in');
    expect(launcherMarkup).not.toContain('faFolderTree');
    expect(sidebar).toContain('grid-rows-[minmax(0,1fr)_232px]');
    expect(sidebar).toContain('grid-rows-[minmax(0,1fr)_0px]');
    expect(sidebar).toContain('{#if isLauncherOverview}');
    expect(sidebar).toContain('aria-label={`Close ${tab.label}`}');
    expect(sidebar).toContain('data-sidebar-close');
    expect(sidebar).toContain('hover:bg-transparent hover:text-foreground');
    expect(sidebar).toContain('sidebar-expanded-card flex');
    expect(sidebar).toContain('rounded-lg bg-muted/35');
    expect(sidebar).toContain('.sidebar-expanded-card :global(*)');
    expect(sidebar).toContain('view-transition-name: sidebar-section');
    expect(sidebar).not.toContain('h-16 grid-cols-4 gap-1.5');
  });

  it('uses a two-zone titlebar without a competing centered search field', () => {
    const titlebar = source('../../WindowTitleBar.svelte');
    const tabs = source('../../WorkspaceTabStrip.svelte');
    const nav = source('../../sidebar-nav/SidebarNav.svelte');
    const chiefTrigger = source('../../sidebar-nav/ChiefTrigger.svelte');
    const workspaceHeader = source('../../../workspace/WorkspaceSidebarHeader.svelte');
    const progressCard = source('../../../workspace/sidebar/WorkspaceProgressCard.svelte');

    expect(titlebar).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(titlebar).toContain(
      'titlebar-left-drag-surface flex min-w-0 self-stretch items-center gap-1 overflow-hidden pl-2',
    );
    expect(titlebar).toContain('data-titlebar-drag-handle');
    expect(titlebar).toContain('data-titlebar-left-drag-handle');
    expect(titlebar).toContain('titlebar-left-drag-handle w-4 shrink-0 self-stretch');
    expect(titlebar).toContain('class="flex min-w-0 items-center gap-1"');
    expect(titlebar).toContain('data-titlebar-fixed-controls');
    expect(titlebar).toContain('class="flex min-w-0 self-end items-center gap-1');
    expect(titlebar).toContain('data-titlebar-workspace-controls');
    expect(titlebar.indexOf('<ChiefTrigger />')).toBeLessThan(titlebar.indexOf('<SidebarNav />'));
    expect(titlebar.indexOf('<SidebarNav />')).toBeLessThan(titlebar.indexOf('<WorkspaceTabStrip'));
    expect(titlebar).toContain(
      "style:margin-left={`${$workspaceViewMode$ === 'columns' ? 0 : panelOffset}px`}",
    );
    expect(titlebar).toContain('activeTabBounds.left + panelOffset + 1');
    expect(titlebar).toContain('.titlebar-drag-handle');
    expect(titlebar).toContain('.titlebar-left-drag-surface');
    expect(titlebar).toContain('.titlebar-left-drag-handle');
    expect(titlebar).not.toContain('style="-webkit-app-region: no-drag"');
    expect(titlebar).toContain('<WorkspaceRepoLauncher />');
    expect(titlebar).toContain('data-titlebar-settings');
    expect(titlebar).toContain('icon={faSettings}');
    expect(titlebar).not.toContain('<PanelLayoutControls');
    expect(titlebar).not.toContain('aria-label="Toggle sidebar"');
    expect(titlebar).not.toContain('mx-0.5 h-4 w-px shrink-0 bg-border/70');
    expect(tabs).toContain('w-fit min-w-0 max-w-[55vw]');
    expect(tabs).toContain('use:reportActiveTabBounds={isCurrent}');
    expect(tabs).toContain('onActiveTabBoundsChange?.({');
    expect(titlebar).toContain('data-active-tab-border-mask');
    expect(titlebar).toContain('absolute -bottom-px z-[60] h-0.5 bg-background');
    expect(nav).not.toContain('faBell');
    expect(nav).not.toContain("id: 'settings'");
    expect(chiefTrigger).toContain("togglePanel('chief')");
    expect(chiefTrigger).toContain('data-chief-trigger');
    expect(workspaceHeader).toContain("label: 'Toggle sidebar'");
    expect(workspaceHeader).toContain('appStore.dispatch(toggleSidebar())');
    expect(progressCard).toContain("label: 'Toggle sidebar'");
    expect(progressCard).toContain('additionalActions={[sidebarToggleAction, sidebarSideAction]}');
    expect(titlebar).not.toContain('class="search-bar"');
  });

  it('anchors native window dragging to the untransformed titlebar wrapper', () => {
    const titlebar = source('../../WindowTitleBar.svelte');

    expect(titlebar).toMatch(/\.window-title-bar-wrapper\s*\{[^}]*-webkit-app-region:\s*drag;/s);
    expect(titlebar).toContain('style:transform="scale({$counterScale})"');
  });

  it('moves the Chief trigger to the title bar and removes its former workspace notch', () => {
    const appLayout = source('../../../../../routes/(app)/+layout.svelte');
    const chiefTrigger = source('../../sidebar-nav/ChiefTrigger.svelte');
    const sidebarPanel = source('../../sidebar-nav/SidebarPanel.svelte');

    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 pl-2');
    expect(appLayout).toContain('workspace-frame relative');
    expect(appLayout).not.toContain('<ChiefNotch />');
    expect(appLayout).not.toContain('clip-path: var(--workspace-clip');
    expect(chiefTrigger).toContain('aria-label="Toggle Chief of Staff"');
    expect(chiefTrigger).toContain('aria-expanded={isActive}');
    expect(chiefTrigger).not.toContain('aria-pressed');
    expect(chiefTrigger).not.toContain('bg-sidebar-accent');
    expect(chiefTrigger).toContain('<AuggieAvatar size={20} />');
    expect(appLayout).toContain('class="workspace-main flex');
    expect(sidebarPanel).toContain('data-panel-item={$panelItem$}');
    expect(sidebarPanel).not.toContain("$panelItem$ === 'chief' ? 'bg-background' : ''");
    expect(sidebarPanel).toContain("transition:slide={{ axis: 'x', duration: 200 }}");
  });

  it('keeps the renderer fully transparent above the native window tint', () => {
    const appCss = source('../../../../../app.css');
    const appLayout = source('../../../../../routes/(app)/+layout.svelte');

    expect(appCss).toContain('background-color: transparent');
    expect(appLayout).not.toContain('background-color: hsl(var(--background) /');
    expect(appLayout).toContain('class="workspace-main flex');
    expect(appLayout).toContain('overflow-hidden bg-background border');
    expect(appLayout).not.toContain('backdrop-filter:');
    expect(appLayout).not.toContain('flex flex-col bg-background"');
  });

  it('moves collapsed terminal controls into the workspace sidebar', () => {
    const sidebar = source('../../../workspace/MultiSelectTabbedSidebar.svelte');
    const dock = source('../../../workspace/WorkspaceTerminalDock.svelte');
    const terminal = source('../../../terminal/QuakeTerminalOverlay.svelte');
    const route = source('../../../../../routes/(app)/workspace/[id]/+page.svelte');

    expect(sidebar).toContain('<WorkspaceTerminalDock {workspaceId} />');
    expect(sidebar).toContain("class={cn('flex h-full flex-col bg-transparent', className)}");
    expect(dock).toContain('{#each $terminals$ as terminal (terminal.id)}');
    expect(dock).toContain('data-dev-script-count');
    expect(dock).toContain("'flex h-10 shrink-0 items-center gap-1 pr-3'");
    expect(dock).toContain("$sidebarSide$ === 'left' ? 'pl-14' : 'pl-3'");
    expect(dock).not.toContain('border-t');
    expect(dock).not.toContain('bg-background');
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
    const fullMode = progressCard.slice(progressCard.indexOf('<!-- Full mode for sidebar -->'));
    const repository = fullMode.indexOf('<!-- repository and branch metadata -->');
    const progress = fullMode.indexOf('<!-- Flame Graph Progress Section');
    const status = fullMode.indexOf('<!-- Status follows identity and progress');

    expect(repository).toBeGreaterThan(-1);
    expect(progress).toBeGreaterThan(repository);
    expect(status).toBeGreaterThan(progress);
    expect(fullMode).toContain('showLabel');
  });
});
