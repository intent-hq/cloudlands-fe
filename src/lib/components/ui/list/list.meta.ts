import { parseUiComponentMetadata } from '../component-metadata';
import { listFixtures } from './list.fixtures';

export const listMetadata = parseUiComponentMetadata({
  id: 'list',
  source: 'src/lib/components/ui/list/index.ts',
  publicImport: '$lib/components/ui/list',
  legacyImports: [],
  exports: ['ListContainer', 'ListEmpty', 'ListItem', 'ListSection', 'listMetadata'],
  category: 'pattern',
  owner: '012-E',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/browser/BrowserPanel.svelte',
    'src/lib/components/file-explorer/VirtualizedFileTree.svelte',
    'src/lib/components/file-explorer/file-tree-view.svelte',
    'src/lib/components/file-tracking/CodeChangesPanel.svelte',
    'src/lib/components/file-tracking/FileChangesList.svelte',
    'src/lib/components/file-tracking/TreeNode.svelte',
    'src/lib/components/notes/NotesPanel.svelte',
    'src/lib/components/terminal/QuakeTerminalOverlay.svelte',
    'src/lib/components/terminal/TerminalSidebar.svelte',
    'src/lib/components/workspace/WorkspaceAgentsList.svelte',
    'src/lib/components/workspace/sidebar/ContextPanel.svelte',
    'src/lib/components/workspace/sidebar/NotesPanel.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/list/list.test.ts',
  removalGate: 'Retain while product lists use the canonical compact row and section patterns.',
  dynamicImports: [],
  fixtures: listFixtures,
});
