import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('workspace sidebar bottom launchers', () => {
  it('keeps Browser and Terminals in equal-width columns', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const browserLauncher = source('../SidebarBrowserLauncher.svelte');
    const terminalDock = source('../WorkspaceTerminalDock.svelte');

    expect(sidebar).toContain('grid w-full shrink-0 gap-3');
    expect(sidebar).toContain("isNewWorkspaceSession ? 'grid-cols-1' : 'grid-cols-2'");
    expect(browserLauncher).toContain('group/launcher relative flex min-w-0 w-full');
    expect(terminalDock).toContain('flex min-w-0 w-full items-center');
    expect(terminalDock).not.toContain('shrink-0 flex-1');
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

    expect(sidebar).toContain('<SidebarBrowserLauncher {workspaceId} {panelLayoutId} />');
    expect(browserLauncher).toContain('getRunningScriptBrowserTarget($scripts$)');
    expect(browserLauncher).toContain('{#if browserTarget && !hasOpenBrowserTab}');
    expect(browserLauncher).toContain('openBrowserPanel(browserTarget.url)');
    expect(browserLauncher).toContain('data-sidebar-running-url={browserTarget.url}');
  });
});
