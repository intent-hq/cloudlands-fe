import { parseUiComponentMetadata } from '../component-metadata';
import { tableFixtures } from './table.fixtures';

export const tableMetadata = parseUiComponentMetadata({
  id: 'table',
  source: 'src/lib/components/ui/table/index.ts',
  publicImport: '$lib/components/ui/table',
  legacyImports: [],
  exports: [
    'Body',
    'Caption',
    'Cell',
    'Footer',
    'Head',
    'Header',
    'Root',
    'Row',
    'Table',
    'TableBody',
    'TableCaption',
    'TableCell',
    'TableFooter',
    'TableHead',
    'TableHeader',
    'TableRow',
    'tableMetadata',
  ],
  // Minimal composition from the table-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as Table from '$lib/components/ui/table';
</script>

<Table.Root>
  <Table.Caption>Workspaces</Table.Caption>
  <Table.Header><Table.Row><Table.Head>Name</Table.Head></Table.Row></Table.Header>
  <Table.Body><Table.Row><Table.Cell>My workspace</Table.Cell></Table.Row></Table.Body>
</Table.Root>`,
  category: 'primitive',
  owner: 'design-system',
  callers: ['src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/table/table.test.ts',
  removalGate: 'Retain while dense tabular data uses shared row and cell treatments.',
  dynamicImports: [],
  fixtures: tableFixtures,
});
