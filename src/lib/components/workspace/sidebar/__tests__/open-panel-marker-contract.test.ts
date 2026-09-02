import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('sidebar open-panel marker removal contract', () => {
  it.each([
    '../../MultiSelectTabbedSidebar.svelte',
    '../NotesPanel.svelte',
    '../ContextItemRow.svelte',
    '../ContextPanel.svelte',
    '../SidebarChangesPanel.svelte',
    '../../../chat/AgentCard.svelte',
    '../../WorkspaceAgentsList.svelte',
    '../../../file-tracking/accept-changes/FileRow.svelte',
    '../FileChangesSection.svelte',
    '../../../file-explorer/VirtualizedFileTree.svelte',
    '../../../file-explorer/file-tree-view.svelte',
    '../FilesPanel.svelte',
  ])('omits the open-panel marker from %s', (path) => {
    const component = source(path);
    expect(component).not.toContain('OpenPanelIndicator');
    expect(component).not.toContain('data-panel-open-marker');
    expect(component).not.toContain('openPanelCount=');
  });

  it('removes the unused shared marker component', () => {
    expect(existsSync(new URL('../OpenPanelIndicator.svelte', import.meta.url))).toBe(false);
  });

  it.each([
    '../../../ui/list/ListItem.svelte',
    '../../../file-tracking/accept-changes/FileRow.svelte',
    '../ContextItemRow.svelte',
    '../SidebarChangesPanel.svelte',
  ])('keeps active row chrome borderless: %s', (path) => {
    const component = source(path);
    expect(component).not.toContain('border-border shadow-xs');
    expect(component).not.toContain('border-input bg-card');
  });

  it('retains the keyboard focus treatment on shared list rows', () => {
    const listItem = source('../../../ui/list/ListItem.svelte');
    expect(listItem).toContain('focus-visible:border-ring');
    expect(listItem).toContain('focus-visible:ring-2');
  });
});
