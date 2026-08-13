import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('workspace column layout contract', () => {
  it('uses the domain workspace ID as the canonical panel layout key', () => {
    const surface = fs.readFileSync(
      path.join(SRC_ROOT, 'routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
      'utf8',
    );
    expect(surface).toContain('const panelLayoutId = $derived(workspaceId);');
    expect(surface).not.toContain('getWorkspaceColumnLayoutId');
  });

  it('hides title-bar tabs and starts column layouts without panel chrome', () => {
    const titleBar = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/layout/WindowTitleBar.svelte'),
      'utf8',
    );
    const surface = fs.readFileSync(
      path.join(SRC_ROOT, 'routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
      'utf8',
    );
    expect(titleBar).toContain("{#if $workspaceViewMode$ === 'single'}");
    expect(titleBar).toContain('{@render titlebarUtilities(false)}');
    expect(titleBar).toContain('{@render titlebarUtilities(true)}');
    expect(titleBar).toContain(
      "{#if $workspaceViewMode$ === 'single'}\n          <WorkspaceTabStrip",
    );
    expect(titleBar).toContain('<WorkspaceRepoLauncher />');
    expect(titleBar.indexOf('<WorkspaceViewModeToggle />')).toBeLessThan(
      titleBar.indexOf('<WorkspaceTabStrip'),
    );
    expect(surface).toContain('layoutId={panelLayoutId}');
    expect(surface).toContain('hideEmptyLayout={columnMode}');
    expect(surface).toContain('allowCloseLastPanel={columnMode}');
  });

  it('uses tab-like column surfaces with surrounding gutters and overlays controls', () => {
    const columns = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/workspace/WorkspaceColumnsView.svelte'),
      'utf8',
    );
    const surface = fs.readFileSync(
      path.join(SRC_ROOT, 'routes/(app)/workspace/[id]/WorkspaceSurface.svelte'),
      'utf8',
    );
    const sidebar = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/workspace/MultiSelectTabbedSidebar.svelte'),
      'utf8',
    );
    const progress = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/workspace/sidebar/WorkspaceProgressCard.svelte'),
      'utf8',
    );
    const titleBar = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/layout/WindowTitleBar.svelte'),
      'utf8',
    );
    const viewModeToggle = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/layout/WorkspaceViewModeToggle.svelte'),
      'utf8',
    );
    const appLayout = fs.readFileSync(path.join(SRC_ROOT, 'routes/(app)/+layout.svelte'), 'utf8');
    const panelLayout = fs.readFileSync(
      path.join(SRC_ROOT, 'lib/components/layout/panel-system/PanelLayout.svelte'),
      'utf8',
    );
    const noteTab = fs.readFileSync(
      path.join(SRC_ROOT, 'features/layout/tab-types/NoteTabType.svelte'),
      'utf8',
    );

    expect(columns).toContain('overflow-hidden rounded-md bg-sidebar');
    expect(columns).not.toContain(
      "import ResizablePanel from '$lib/components/layout/ResizablePanel.svelte'",
    );
    expect(columns).not.toContain('w-[22.5rem]');
    expect(columns).toContain('gap-2');
    expect(columns).toContain('pl-2 pr-2 pt-2');
    expect(columns).toContain('scrollbar-none h-full min-h-0 w-full overflow-x-auto');
    expect(columns).toContain('selectPanelCanvasWidthsByWorkspaceId');
    expect(columns).toContain('livePanelCanvasWidths[workspaceId]');
    expect(columns).toContain('onPanelCanvasWidthChange={(width) => updatePanelCanvasWidth');
    expect(columns).not.toContain('$resizablePanelSizes$[`workspace-left-panel-width:');
    expect(columns).not.toContain('workspace-panel-columns-width:');
    expect(surface).toContain("canvasSizing={columnMode ? 'content' : 'viewport'}");
    expect(columns).not.toContain("{#key stack.join(':')}");
    expect(surface).toContain('onDestroy(() => {');
    expect(surface).not.toContain('onDestroy(async () => {');
    expect(surface).not.toContain('flushPendingAgentDeletionsRequested');
    expect(panelLayout).toContain("contained ? 'overflow-hidden py-2 pl-2'");
    expect(panelLayout).toContain('panelLayoutScopeMounted(mountedLayoutId)');
    expect(panelLayout).toContain('panelLayoutScopeUnmounted(mountedLayoutId)');
    expect(noteTab).toContain('class="h-full bg-background text-foreground"');
    expect(columns).toContain('onCloseWorkspace={(event) => closeWorkspace(workspaceId, event)}');
    expect(columns).not.toContain('absolute right-2 top-2');
    expect(surface).toContain('{onCloseWorkspace}');
    expect(surface).toContain('draggableTitleRegion={columnMode}');
    expect(sidebar).toContain('{onCloseWorkspace} />');
    expect(sidebar).toContain('draggable={draggableTitleRegion}');
    expect(progress).toContain('data-workspace-header-actions');
    expect(progress.indexOf('aria-label={`Close workspace ${workspaceId}`}')).toBeGreaterThan(
      progress.indexOf('<DropdownMenu bind:open={dropdownOpen}>'),
    );
    expect(columns).not.toContain('w-[26rem]');
    expect(columns).not.toContain('class:ring-1');
    expect(surface).toContain('data-loading={!$workspace}');
    expect(titleBar).toContain('class:workspace-columns-titlebar={overlayWorkspaceColumns}');
    expect(titleBar).toContain('.window-title-bar-wrapper.workspace-columns-titlebar');
    expect(titleBar).toContain('pointer-events: none');
    expect(titleBar).toContain('[data-titlebar-workspace-controls]');
    expect(titleBar).toContain(
      "style:margin-left={`${$workspaceViewMode$ === 'columns' ? 0 : panelOffset}px`}",
    );
    expect(titleBar).toContain("$workspaceViewMode$ === 'columns' ? 'self-center' : 'self-end'");
    expect(titleBar).toContain(
      '<IntentNavigationIcon name="settings" size={16} class="pointer-events-none size-4!" />',
    );
    expect(viewModeToggle).toContain("name={isColumns ? 'tabs' : 'spaces'}");
    expect(appLayout).toContain('overlayWorkspaceColumns={showWorkspaceColumns}');
    expect(appLayout).toContain('style:padding-top={showWorkspaceColumns');
    expect(columns).not.toContain('data-titlebar-clearance');
    expect(columns).not.toContain('globalSidebarOpen');
    expect(columns).not.toContain('titlebarClearance');
    expect(appLayout).toContain('<WorkspaceColumnsView />');
    expect(appLayout).not.toContain('globalSidebarOpen');
    expect(appLayout).not.toContain('selectPanelItem');
    expect(appLayout).toContain('useSelectedWorkspace: showWorkspaceColumns');
    expect(appLayout).toContain('selectedWorkspaceId: $currentWorkspaceTabId');
    expect(columns).not.toContain('padding-top: calc(1.25rem + 35px)');
    expect(appLayout).toContain("showWorkspaceColumns\n              ? ''");
  });
});
