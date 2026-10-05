import type { UiComponentMetadata } from '../component-metadata';
import { messageComposerFixtures } from './message-composer.fixtures';

export const messageComposerMetadata = {
  id: 'message-composer',
  source: 'src/lib/components/ui/message-composer/message-composer.svelte',
  publicImport: '$lib/components/ui/message-composer',
  legacyImports: [],
  exports: [
    'MessageComposer',
    'MessageComposerProps',
    'MessageComposerSlotContext',
    'QueuedMessage',
    'messageComposerMetadata',
  ],
  category: 'primitive',
  owner: 'design-system',
  callers: ['src/lib/component-catalog/renderers/MessageComposerCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/message-composer/message-composer.test.ts',
  removalGate: 'Retain while exported; composer, queue, file, suggestion, and history tests pass.',
  dynamicImports: [],
  fixtures: messageComposerFixtures,
  useWhen: ['Composing messages with optional attachments, suggestions, or queued drafts.'],
  dontUseWhen: ['Displaying field help text; use InputMessage for helper or error copy.'],
} satisfies UiComponentMetadata;
