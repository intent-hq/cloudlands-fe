import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { m } from '$shared/paraglide/messages.js';

function source(relativePath: string) {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Spaces panel view-mode control', () => {
  it('cycles the persisted view mode from the Spaces header icon', () => {
    const panel = source('src/lib/components/layout/sidebar-nav/SidebarPanel.svelte');

    expect(panel).toContain('data-spaces-view-mode-trigger');
    expect(panel).toContain('selectAllSpacesViewMode()');
    expect(panel).toContain('selectAllSpacesViewMode.select(appStore.state)');
    expect(panel).toContain('(currentIndex + 1) % allSpacesViewModes.length');
    expect(panel).toContain('appStore.dispatch(setAllSpacesViewMode(nextMode))');
    expect(panel).toContain('onclick={handleAllSpacesViewModeCycle}');
    expect(panel).not.toContain('data-spaces-view-mode-options');
    expect(panel).not.toContain('<DropdownMenu');
    expect(panel).toContain('aria-label={m.layout_sidebarPanel_sortOrGroupSpaces_ariaLabel({');
    expect(panel).toContain('mode: allSpacesViewModeLabel,');
    expect(panel).toContain("{ value: 'recent', label: m.layout_allCard_recent_label() }");
    expect(panel).toContain("{ value: 'repo', label: m.layout_allCard_repo_label() }");
    expect(panel).toContain("{ value: 'status', label: m.layout_allCard_status_label() }");
    expect(m.layout_allCard_recent_label()).toBe('Recent');
    expect(m.layout_allCard_repo_label()).toBe('Repo');
    expect(m.layout_allCard_status_label()).toBe('Status');
  });

  it('does not render the old segmented view-mode strip in the list body', () => {
    const card = source('src/lib/components/layout/sidebar-nav/cards/AllWorkspacesCard.svelte');

    expect(card).not.toContain('view-mode-tabs');
    expect(card).not.toContain('view-mode-tab');
    expect(card).not.toContain('setAllSpacesViewMode');
  });
});
