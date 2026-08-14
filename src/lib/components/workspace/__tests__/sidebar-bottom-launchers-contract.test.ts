import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('workspace sidebar bottom launchers', () => {
  it('keeps Browser and Terminals equal-width only in compact launcher mode', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const browserLauncher = source('../SidebarBrowserLauncher.svelte');
    const terminalDock = source('../WorkspaceTerminalDock.svelte');
    const bottomStart = sidebar.indexOf('<!-- Compact launchers stay fixed;');
    const bottomEnd = sidebar.indexOf('\n</div>\n\n<style>', bottomStart);
    const bottomLaunchers = sidebar.slice(bottomStart, bottomEnd);
    const overviewStart = bottomLaunchers.indexOf('{#if isLauncherOverview}');
    const expandedStart = bottomLaunchers.indexOf('{:else}', overviewStart);
    const usesConditionalOuterGrid =
      bottomLaunchers.includes("isLauncherOverview ? 'grid gap-3 px-6 pt-3' : 'px-4 pt-2'") &&
      bottomLaunchers.includes(
        "isLauncherOverview ? (isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2') : ''",
      ) &&
      bottomLaunchers.includes('data-sidebar-compact-bottom-row={isLauncherOverview || undefined}');
    const usesNestedOverviewGrid =
      bottomLaunchers.includes("class={cn('grid w-full gap-3'") &&
      bottomLaunchers.includes("isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2'") &&
      bottomLaunchers.includes('data-sidebar-compact-bottom-row');

    expect(bottomStart).toBeGreaterThan(-1);
    expect(bottomEnd).toBeGreaterThan(bottomStart);
    expect(bottomLaunchers).toContain("'relative z-30 w-full shrink-0");
    expect(usesConditionalOuterGrid || usesNestedOverviewGrid).toBe(true);
    expect(overviewStart).toBeGreaterThan(-1);
    expect(expandedStart).toBeGreaterThan(overviewStart);
    expect(bottomLaunchers.slice(overviewStart, expandedStart)).not.toContain(
      '<SidebarExpandedTabStrip',
    );
    expect(bottomLaunchers.slice(expandedStart)).toContain('<SidebarExpandedTabStrip');
    expect(browserLauncher).toContain('group/launcher relative flex min-w-0 w-full');
    expect(terminalDock).toContain('flex min-w-0 w-full items-center');
    expect(terminalDock).not.toContain('shrink-0 flex-1');
  });

  it('keeps expanded tab-strip tabs flex containers so the clipped deck never overflows', () => {
    // Regression: block-flow tabs add the line-box strut's descent below the
    // empty-baseline edge-tab buttons, overflowing the h-10 overflow-hidden deck
    // and clipping the strip's bottom edge on platforms with taller font metrics.
    const transitions = source('../multi-select-sidebar-transitions.css');
    const tabRule = transitions.slice(
      transitions.indexOf('.sidebar-expanded-tab {'),
      transitions.indexOf('}', transitions.indexOf('.sidebar-expanded-tab {')),
    );

    expect(tabRule).toContain('display: flex;');
  });

  it('scopes terminal and script launcher state to the dock workspace', () => {
    const terminalDock = source('../WorkspaceTerminalDock.svelte');
    const terminalOverlay = source('../../terminal/QuakeTerminalOverlay.svelte');

    expect(terminalDock).toContain('selectActiveTerminalIdForWorkspace(workspaceIdStore)');
    expect(terminalDock).toContain('selectTerminalsForWorkspace(workspaceIdStore)');
    expect(terminalOverlay).toContain('selectIsTerminalOverlayOpenForWorkspace(workspaceIdStore)');
    expect(terminalOverlay).toContain('selectTerminalsForWorkspace(workspaceIdStore)');
  });

  it('shows the Browser icon only while the current panel layout has a browser tab', () => {
    const browserLauncher = source('../SidebarBrowserLauncher.svelte');

    expect(browserLauncher).toContain('const allTabs$ = selectAllTabs(panelLayoutIdStore)');
    expect(browserLauncher).toContain("$allTabs$.some((tab) => tab.type === 'browser')");
    expect(browserLauncher).toContain('{#if hasOpenBrowserTab}');
  });

  it('offers a running script URL only while the Browser panel is closed', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const browserLauncher = source('../SidebarBrowserLauncher.svelte');

    expect(sidebar).toContain('<SidebarBrowserLauncher');
    expect(sidebar).toContain("onExpand={() => handleTabClick('browser')}");
    expect(browserLauncher).toContain('getRunningScriptBrowserTarget($scripts$)');
    expect(browserLauncher).toContain('{#if browserTarget && !hasOpenBrowserTab}');
    expect(browserLauncher).toContain('openBrowserPanel(browserTarget.url)');
    expect(browserLauncher).toContain('data-sidebar-running-url={browserTarget.url}');
  });

  it('keeps the linked PR Changes action and scoped Files action without Sync regression', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');

    expect(sidebar).toContain('data-sidebar-changes-pr={linkedPrimaryPr.number}');
    expect(sidebar).toContain('openExternalUrl(linkedPrimaryPr.url)');
    expect(sidebar).not.toContain('data-sidebar-changes-sync');
    expect(sidebar).toContain(
      'filePath={$fileExplorerWorkspacePath}\n                          {workspaceId}',
    );
    expect(sidebar).toContain('data-files-open-in');
  });
});
