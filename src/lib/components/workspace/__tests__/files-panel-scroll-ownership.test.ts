import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('Files panel scroll ownership', () => {
  it('keeps the sidebar shell fixed and delegates scrolling to the virtualized tree', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const filesPanel = source('../sidebar/FilesPanel.svelte');
    const virtualizedTree = source('../../file-explorer/VirtualizedFileTree.svelte');

    expect(sidebar).toContain(
      "tabId === 'files'\n                        ? 'overflow-hidden pb-0'",
    );
    expect(sidebar).toContain('flex h-full min-h-0 flex-col px-4');
    expect(filesPanel).toContain("'flex h-full min-h-0 flex-col pb-3'");
    expect(filesPanel).toContain('class="min-h-0 flex-1 overflow-hidden"');
    expect(filesPanel).not.toContain('overflow-y-auto');
    expect(virtualizedTree).toContain('class="h-full overflow-y-auto overflow-x-hidden"');
  });

  it('disables the generic outer ScrollArea for the expanded Code panel', () => {
    const explorer = source('../../file-explorer/VSCodeFileExplorer.svelte');
    const scrollablePanel = source('../../ui/VSCodeScrollablePanel.svelte');

    expect(explorer).toContain('scrollContent={false}');
    expect(scrollablePanel).toContain('scrollContent?: boolean;');
    expect(scrollablePanel).toContain('{#if scrollContent}');
    expect(scrollablePanel).toContain('overflow-hidden pb-1 {contentClass}');
  });

  it('keeps file search collapsed until requested or populated', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const search = source('../sidebar/ExpandableFileSearch.svelte');

    expect(sidebar).toContain('<ExpandableFileSearch');
    expect(search).toContain("query = $bindable('')");
    expect(search).toContain('let expanded = $state(Boolean(query))');
    expect(search).toContain('{#if expanded}');
    expect(search).toContain('data-file-search-toggle');
    expect(search).toContain('if (!query) expanded = false');
  });

  it('aligns the collapsed search icon with the top-level file tree gutter', () => {
    const sidebar = source('../MultiSelectTabbedSidebar.svelte');
    const search = source('../sidebar/ExpandableFileSearch.svelte');
    const listItem = source('../../ui/list/ListItem.svelte');

    expect(sidebar).toContain('data-file-tree-toolbar');
    expect(search).toContain('class="ml-0.5 shrink-0 text-subtle"');
    expect(listItem).toContain("padding: 'min-h-7 px-2 py-0.5'");
  });
});
