import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

function selfClosingTag(componentSource: string, componentName: string) {
  return componentSource.match(new RegExp(`<${componentName}\\b[\\s\\S]*?/>`))?.[0] ?? '';
}

describe('workspace sidebar hierarchy presentation contract', () => {
  it('moves compact semantic global navigation beside the title-bar workspace tabs', () => {
    const navigation = source('../../layout/sidebar-nav/SidebarNav.svelte');
    const titleBar = source('../../layout/WindowTitleBar.svelte');
    const appLayout = source('../../../../routes/(app)/+layout.svelte');

    expect(navigation).toContain('data-top-navigation');
    expect(navigation).toContain('variant="ghost-light"');
    expect(navigation).toContain('size="icon"');
    expect(navigation).toContain('TITLEBAR_NAVIGATION_CONTROL_CLASS');
    expect(navigation).toContain('data-nav-item={item.id}');
    expect(navigation).toContain('name="dandelion"');
    expect(navigation).not.toContain('name="spaces"');
    expect(navigation).not.toContain('SidebarNavHoverCard');
    expect(titleBar).toContain('<SidebarNav />');
    expect(titleBar.indexOf('<SidebarNav />')).toBeLessThan(titleBar.indexOf('<WorkspaceTabStrip'));
    expect(titleBar).not.toContain('ChiefTrigger');
    expect(titleBar).toContain('titlebar-left-drag-surface');
    expect(titleBar).toContain('data-titlebar-left-drag-handle');
    expect(titleBar).toContain('titlebar-fixed-controls flex min-w-0 items-center gap-1');
    expect(titleBar).toContain('<WorkspaceTabStrip');
    expect(titleBar).toContain('activeWorkspaceId={routedWorkspaceId}');
    expect(titleBar).toContain('data-titlebar-settings');
    expect(appLayout).not.toContain('<SidebarNav />');
  });

  it('opens a title-bar workspace tab before navigating from the spaces combobox', () => {
    const card = source('../../layout/sidebar-nav/cards/AllWorkspacesCard.svelte');
    const openTab = card.indexOf('appStore.dispatch(openWorkspaceTab(workspaceId))');
    const navigate = card.indexOf('await goto(route)');

    expect(card).toContain("from '$store/renderer/slices/tab-state/tab-state-slice'");
    expect(openTab).toBeGreaterThanOrEqual(0);
    expect(openTab).toBeLessThan(navigate);
  });

  it('orders the live identity, progress, then current status', () => {
    const progress = source('../sidebar/WorkspaceProgressCard.svelte');
    const fullMode = progress.slice(
      progress.indexOf('<div class="flex w-full flex-col" data-workspace-title-section>'),
    );
    const title = fullMode.indexOf('<!-- Workspace Header -->');
    const status = fullMode.indexOf('<!-- Status follows identity and progress');
    const metadata = fullMode.indexOf('<!-- repository and branch metadata -->');
    const progressSection = fullMode.indexOf('data-workspace-task-progress');

    expect(title).toBeGreaterThanOrEqual(0);
    expect(title).toBeLessThan(metadata);
    expect(metadata).toBeLessThan(progressSection);
    expect(progressSection).toBeLessThan(status);
    expect(fullMode).toContain('class="flex w-full flex-col" data-workspace-title-section');
    expect(fullMode).toContain('type-caption mb-4 flex h-5 w-full min-w-0 items-center gap-2.5');
    expect(fullMode).toContain('class="flex w-full flex-col pb-1"');
    expect(fullMode).toContain('flex w-full flex-col gap-3.5 pb-2 text-left');
    expect(fullMode).not.toContain('pb-1 pl-1');
    expect(fullMode).not.toContain('pb-2 pl-1 text-left');
    expect(fullMode).not.toContain('px-0.5 py-1');
    expect(fullMode).toContain('{$workspace.branch}');
    expect(fullMode).toContain('presentation="repository"');
    expect(fullMode).toContain('repositoryOpen={repoTooltipOpen}');
    expect(fullMode).not.toContain('data-sidebar-branch-icon');
    expect(fullMode).not.toContain('<CheckoutModePill workspace={$workspace} />');
    expect(fullMode).not.toContain('data-workspace-title-section class="bg-');
  });

  it('renders one task progress bar with status details in its hover surface', () => {
    const progress = source('../sidebar/FlameGraph.svelte');
    const sharedProgress = source('../TaskStatusProgress.svelte');

    expect(progress).toContain('<TaskStatusProgress');
    expect(sharedProgress).toContain('role="progressbar"');
    expect(sharedProgress).toContain('style:flex-grow={segment.count}');
    expect(sharedProgress).toContain('TASK_PROGRESS_SEGMENT_CLASSES[');
    expect(sharedProgress).toContain('segment.visualState');
    expect(progress).toContain('content={taskListTooltip}');
    expect(progress).toContain('bg-secondary!');
    expect(progress).toContain('overflow-x-hidden overflow-y-auto px-2 pt-2');
    expect(progress).toContain('onclick={() => specNoteId && onTaskClick?.(specNoteId)}');
    expect(progress).toContain('onclick={() => onTaskClick?.(task.note.id as string)}');
    expect(progress).toContain('TASK_STATUS_INDICATOR_CLASSES[status]');
    expect(progress).toContain('shrink-0 font-normal! text-subtle');
    expect(progress).not.toContain('hover:bg-accent/50');
    expect(progress).not.toContain('<table');
    expect(progress).not.toContain('faFileAlt');
    expect(progress).not.toContain('>Progress<');
  });

  it('uses the same three scan levels in the scoped workspace header', () => {
    const header = source('../WorkspaceSidebarHeader.svelte');

    expect(header).toContain('type-title');
    expect(header).toContain('<!-- status message -->');
    expect(header).toContain('<!-- repository and branch metadata -->');
    expect(header).toContain('type-caption flex h-5 w-full min-w-0 items-center');
  });

  it('keeps one dominant section under the workspace identity and launchers at the bottom', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const tabs = source('../multi-select-sidebar-tabs.ts');
    const agents = source('../WorkspaceAgentsList.svelte');
    const context = source('../sidebar/ContextPanel.svelte');
    const notes = source('../sidebar/NotesPanel.svelte');
    const changes = source('../sidebar/SidebarChangesPanel.svelte');

    expect(sidebar).toContain('shrink-0 px-6 pb-2 pt-5');
    expect(sidebar).toContain('data-workspace-title-region');
    expect(sidebar).toContain('<div class="px-4 pb-1 pt-4">');
    const addContext = selfClosingTag(sidebar, 'AddContextSection');
    expect(addContext).toContain('onAddNote={onCreateNote}');
    expect(addContext).toMatch(/\bcompact\b/);
    expect(sidebar).toContain('data-testid="agent-panel"');
    expect(sidebar).toContain('flex h-full flex-1 flex-col px-4');
    expect(agents).toContain('<div class="flex flex-col gap-0.5">');
    expect(context).toContain('flush');
    expect(notes).toContain("flush && 'px-0'");
    expect(changes).toContain(
      'sidebar-changes-container min-h-full flex flex-col flex-1 overflow-y-auto outline-none',
    );
    expect(sidebar).toContain('data-testid="sidebar-launchers"');
    expect(sidebar).toContain('data-launcher-layout="tiles"');
    expect(sidebar).toContain('h-56 w-full auto-rows-fr grid-cols-2 gap-3');
    expect(sidebar).toContain('rounded-lg border border-border bg-sidebar p-2 text-foreground');
    expect(sidebar).toContain('data-sidebar-overlay');
    expect(sidebar).toContain('sidebar-expanded-card relative');
    expect(tabs).toContain('m.workspace_multiSelectSidebar_contextTab_label()');
    expect(sidebar).toContain('TAB_DEFINITIONS.filter');
    expect(sidebar).not.toContain('tab-bar-container');
    expect(sidebar).not.toContain('transition:slide');
  });

  it('separates section triggers from direct item actions and their tooltips', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('data-sidebar-launcher={tab.id}');
    expect(sidebar).toContain('in:cardMorph|global={{');
    expect(sidebar).toContain('out:cardMorph|global={{');
    expect(sidebar).toContain('aria-expanded="false"');
    expect(sidebar).toContain("previousTabId === tabId ? 'overview' : tabId");
    expect(sidebar).not.toContain('content={`${tab.label}: ${getTabDescription');
    expect(sidebar).toContain('data-sidebar-agent={agent.id}');
    expect(sidebar).toContain('data-sidebar-context={note.id}');
    expect(sidebar).not.toContain('data-sidebar-change={changePath}');
    expect(sidebar).toContain('const LAUNCHER_ICON_LIMIT = 6');
    expect(sidebar).toContain('grid h-9 w-full min-w-0 grid-flow-col items-start overflow-visible');
    expect(sidebar).toContain('data-launcher-pack="left"');
    expect(sidebar).toContain('deriveAgentLauncherItems(');
    expect(sidebar).toContain('LAUNCHER_ICON_LIMIT,');
    expect(sidebar).toContain('deriveNoteLauncherItems(');
    expect(sidebar).toContain('(note, allNotes) => !isChildNote(note, allNotes)');
    expect(sidebar).toContain('{#each launcherNotes as note, index (note.id)}');
    expect(sidebar).not.toContain('$notes.slice(0, LAUNCHER_ICON_LIMIT)');
    expect(sidebar).toContain('const LAUNCHER_ICON_BUTTON_CLASS =');
    expect(sidebar).toContain('data-files-open-in');
    expect(sidebar).toContain('filePath={$fileExplorerWorkspacePath}');
    expect(sidebar).toContain('side="top"');
    expect(sidebar).toContain('icon={faArrowUpRightFromSquare}');
    expect(sidebar).toContain('m.ui_openCombo_openInApp_tooltip()');
    expect(sidebar).not.toContain('m.ui_openCombo_open_label()');
    expect(sidebar).not.toContain('faChevronDown');
    expect(sidebar).toContain('const sourcePanelId = selectFocusedPanelId.select(');
    expect(sidebar).toContain('openAgentTabRequested(workspaceId, {');
    expect(sidebar).toContain('sourcePanelId,');
    expect(sidebar).toContain('handleOpenAgentInPanel(agent.id, event);');
    expect(sidebar).toContain('onSelect={({ agentId, event }) =>');
    expect(sidebar).toContain('handleOpenAgentInPanel(agentId, event)}');
    expect(sidebar).toContain('onOpenAgent={handleOpenAgentInPanel}');
    expect(sidebar).toContain('onSelectAgent={handleOpenAgentInPanel}');
    expect(sidebar).toContain(
      'onclick={(event) => handleOpenNoteInPanel(note.id as string, event)}',
    );
    expect(sidebar).toContain('rounded-sm outline-none transition-colors');
    expect(sidebar).toContain('rounded-lg border border-border bg-sidebar');
    expect(sidebar).not.toContain('focus-visible:ring-0');
  });

  it('keeps launcher morphs component-local in every workspace layout', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('function cardMorph(');
    expect(sidebar).toContain("direction: 'expand'");
    expect(sidebar).toContain("direction: 'collapse'");
    expect(sidebar).not.toContain('startViewTransition');
    expect(sidebar).not.toContain('view-transition-name');
  });

  it('morphs the shell first and reveals destination content only as it settles', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const transitions = source('../multi-select-sidebar-transitions.css');

    expect(sidebar).toContain('launcherRects.set');
    expect(sidebar).toContain('expandedCardRects.set');
    expect(sidebar).toContain('mountedLauncherRect ?? launcherRects.get(tabId)');
    expect(sidebar).toContain('launcherRect.left - cardRect.left');
    expect(sidebar).toContain('launcherRect.width / cardRect.width');
    expect(sidebar).toContain('duration: 300');
    expect(sidebar).toContain('transform-origin: top left');
    expect(sidebar).toContain('getFixedContainingBlockOffset(node)');
    expect(sidebar).toContain('position: fixed; left: ${fixedLeft}px');
    expect(sidebar).toContain("direction === 'expand' ? cubicOut(t) : cubicIn(t)");
    expect(sidebar).toContain('(t - 0.72) / 0.28');
    expect(sidebar).toContain('data-sidebar-expanded-content');
    expect(sidebar).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    expect(transitions).toContain('opacity: var(--sidebar-card-content-opacity, 1)');
    expect(transitions).not.toContain('grid-template-rows');
    expect(transitions).not.toContain('::view-transition');
  });

  it('waits to reveal the launcher grid until the collapsing card reaches its source', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('function launcherGridReveal(_node: Element)');
    expect(sidebar).toContain('delay: 210');
    expect(sidebar).toContain('duration: 90');
    expect(sidebar).toContain('in:launcherGridReveal|global');
  });

  it('opens an embedded browser from a first-class workspace launcher', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const browserLauncher = source('../SidebarBrowserLauncher.svelte');

    expect(sidebar).toContain('<SidebarBrowserLauncher');
    expect(sidebar).toContain("onExpand={() => handleTabClick('browser')}");
    expect(browserLauncher).toContain('data-sidebar-launcher="browser"');
    expect(browserLauncher).toContain('onclick={openBrowser}');
    expect(browserLauncher).toContain('getPanelLayoutManager(panelLayoutId).openBrowserPanel()');
    expect(browserLauncher).toContain(
      'aria-label={m.workspace_browserLauncher_openBrowser_ariaLabel()}',
    );
    expect(browserLauncher).toContain('icon={faWindowMaximize}');
    expect(browserLauncher).toContain('hover:bg-background/70');
    expect(browserLauncher).toContain('focus-visible:bg-background/70');
    expect(browserLauncher).toContain('class="size-3"');
    expect(browserLauncher).not.toContain('faArrowUpRightFromSquare');
  });
});
