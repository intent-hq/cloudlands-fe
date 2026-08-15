import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('sidebar open-panel marker contract', () => {
  it('derives compact launchers from all tabs and canonical identity', () => {
    const sidebar = source('../../MultiSelectTabbedSidebar.svelte');
    expect(sidebar).toContain('selectAllTabs(panelLayoutIdStore)');
    expect(sidebar).toContain('getPanelTabOpenState($allPanelTabs$, $activeTab$');
    expect(sidebar).toContain('<OpenPanelIndicator');
  });

  it.each([
    '../NotesPanel.svelte',
    '../ContextItemRow.svelte',
    '../../../chat/AgentCard.svelte',
    '../../../file-tracking/accept-changes/FileRow.svelte',
    '../../../file-explorer/VirtualizedFileTree.svelte',
  ])('keeps the shared presentation glyph on expanded rows: %s', (path) => {
    expect(source(path)).toContain('<OpenPanelIndicator');
  });

  it('routes indicator comparisons through panelTabsAreEquivalent', () => {
    const selectors = source(
      '../../../../../store/renderer/slices/panel-layout/panel-layout-selectors.ts',
    );
    expect(selectors).toContain("import { panelTabsAreEquivalent } from './panel-tab-identity'");
    expect(selectors.match(/panelTabsAreEquivalent\(/g)).toHaveLength(2);
  });
});
