import { parseUiComponentMetadata } from '../component-metadata';
import { dialogFixtures } from './dialog.fixtures';

export const dialogMetadata = parseUiComponentMetadata({
  id: 'dialog',
  source: 'src/lib/components/ui/dialog/index.ts',
  publicImport: '$lib/components/ui/dialog',
  legacyImports: [],
  exports: [
    'Close',
    'Content',
    'Description',
    'Dialog',
    'DialogClose',
    'DialogContent',
    'DialogDescription',
    'DialogFooter',
    'DialogHeader',
    'DialogOverlay',
    'DialogPortal',
    'DialogTitle',
    'DialogTrigger',
    'Footer',
    'Header',
    'Overlay',
    'Portal',
    'Root',
    'Title',
    'Trigger',
  ],
  // Minimal composition from the dialog-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
</script>

<Dialog.Root>
  <Dialog.Trigger>Open dialog</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Workspace details</Dialog.Title>
      <Dialog.Description>Review the workspace information.</Dialog.Description>
    </Dialog.Header>
  </Dialog.Content>
</Dialog.Root>`,
  category: 'primitive',
  owner: '007-B4',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/dialog/dialog.test.ts',
  removalGate: 'Retain while exported; require metadata, fixtures, and behavioral coverage.',
  dynamicImports: [],
  fixtures: dialogFixtures,
});
