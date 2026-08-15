import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Spaces panel view-mode control', () => {
  it('offers explicit persisted view modes and archived visibility in one menu', () => {
    const panel = source('src/lib/components/layout/sidebar-nav/SidebarPanel.svelte');

    expect(panel).toContain('data-spaces-options-trigger');
    expect(panel).toContain('selectAllSpacesViewMode()');
    expect(panel).toContain('selectShowArchivedWorkspaces()');
    expect(panel).toContain('appStore.dispatch(setAllSpacesViewMode(nextMode))');
    expect(panel).toContain('appStore.dispatch(setShowArchivedWorkspaces(checked))');
    expect(panel).toContain('data-spaces-view-mode-options');
    expect(panel).toContain('<Menu.RadioGroup');
    expect(panel).toContain('<Menu.CheckboxItem');
    expect(panel).not.toContain('handleAllSpacesViewModeCycle');
    expect(panel).not.toContain('faLayerGroup');
    expect(panel).toContain("{ value: 'recent', label: m.layout_allCard_recent_label() }");
    expect(panel).toContain("{ value: 'repo', label: m.layout_allCard_repo_label() }");
    expect(panel).toContain("{ value: 'status', label: m.layout_allCard_status_label() }");
    expect(m.layout_allCard_recent_label()).toBe('Recent');
    expect(m.layout_allCard_repo_label()).toBe('Repo');
    expect(m.layout_allCard_status_label()).toBe('Status');
    expect(m.layout_sidebarPanel_groupBy_label()).toBe('Group by');
    expect(m.layout_sidebarPanel_workspaceListOptions_tooltip()).toBe('Workspace list options');
  });

  it('does not render the old segmented view-mode strip in the list body', () => {
    const card = source('src/lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte');

    expect(card).not.toContain('view-mode-tabs');
    expect(card).not.toContain('view-mode-tab');
    expect(card).not.toContain('setAllSpacesViewMode');
  });
});
