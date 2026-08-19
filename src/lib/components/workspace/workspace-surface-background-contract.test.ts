import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('workspace surface background contract', () => {
  it('keeps the sidebar shell transparent in both themes', () => {
    const sidebar = source('src/lib/components/layout/sidebar-nav/SidebarPanel.svelte');
    expect(sidebar).toContain(
      'sidebar-panel h-full flex flex-col relative text-sidebar-foreground',
    );
    expect(sidebar).not.toMatch(/sidebar-panel[^"\n]*(?:bg-sidebar|background)/);
  });

  it('paints tab, column, sidebar-host, and panel-canvas surfaces with the sidebar token', () => {
    const layout = source('src/lib/components/workspace/WorkspaceLayout.svelte');
    const columns = source('src/lib/components/workspace/WorkspaceColumnsView.svelte');
    const panelLayout = source('src/lib/components/layout/panel-system/PanelLayout.svelte');
    const appLayout = source('src/routes/(app)/+layout.svelte');
    expect(layout).toContain('workspace-page h-full flex flex-col relative bg-sidebar');
    expect(layout).toContain('workspace-sidebar-{sidebarSide} flex-none h-full min-w-0 bg-sidebar');
    expect(layout).not.toContain("'bg-background'");
    expect(columns).toContain('rounded-xl border border-border bg-sidebar shadow-sm');
    expect(panelLayout).toContain('panel-layout h-full w-full flex flex-col bg-sidebar');
    expect(appLayout).toContain("'rounded-xl bg-sidebar border border-border shadow-sm'");
  });

  it('keeps every renderer shell layer transparent', () => {
    const appCss = source('src/app.css');
    const appHtml = source('src/app.html');
    const appLayout = source('src/routes/(app)/+layout.svelte');
    const titlebar = source('src/lib/components/layout/WindowTitleBar.svelte');
    expect(appCss).toMatch(/html,\s*body\s*\{\s*background-color: transparent;/);
    expect(appCss).toMatch(/#app\s*\{\s*background-color: transparent;/);
    expect(appHtml).toMatch(/html,\s*body,\s*#app\s*\{\s*background: transparent;/);
    expect(appLayout).toContain('overflow-hidden bg-transparent text-foreground');
    expect(appLayout).toContain('workspace-frame-row flex flex-1 min-h-0 bg-transparent');
    expect(titlebar).toMatch(/\.window-title-bar-wrapper[\s\S]*background: transparent;/);
  });
});
