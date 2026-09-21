import { parseUiComponentMetadata } from '../component-metadata';
import { sheetFixtures } from './sheet.fixtures';

export const sheetMetadata = parseUiComponentMetadata({
  id: 'sheet',
  source: 'src/lib/components/ui/sheet/index.ts',
  publicImport: '$lib/components/ui/sheet',
  legacyImports: ['$lib/components/ui/sheet/index.js'],
  exports: [
    'Close',
    'Content',
    'Description',
    'Footer',
    'Header',
    'Overlay',
    'Portal',
    'Root',
    'Sheet',
    'SheetClose',
    'SheetContent',
    'SheetDescription',
    'SheetFooter',
    'SheetHeader',
    'SheetOverlay',
    'SheetPortal',
    'SheetTitle',
    'SheetTrigger',
    'Title',
    'Trigger',
  ],
  // Minimal composition from the sheet-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet';
</script>

<Sheet.Root>
  <Sheet.Trigger>Open sheet</Sheet.Trigger>
  <Sheet.Content>
    <Sheet.Header>
      <Sheet.Title>Workspace details</Sheet.Title>
      <Sheet.Description>Review the workspace information.</Sheet.Description>
    </Sheet.Header>
  </Sheet.Content>
</Sheet.Root>`,
  category: 'primitive',
  owner: '007-B4',
  callers: ['src/lib/components/ui/sidebar/sidebar.svelte'],
  replacement: null,
  useWhen: [
    'Content supplies a flex body with px-6 py-4 padding. Place Header and Footer directly inside Content; they retain their own inset without doubled padding. Ordinary body content needs no padding wrapper.',
  ],
  characterizationTest: 'src/lib/components/ui/sheet/sheet.test.ts',
  removalGate: 'Retain while exported; require metadata, fixtures, and behavioral coverage.',
  dynamicImports: [],
  fixtures: sheetFixtures,
});
