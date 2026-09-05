import type { UiComponentMetadata } from '../component-metadata';
import { accordionFixtures } from './accordion.fixtures';

export const accordionMetadata = {
  id: 'accordion',
  source: 'src/lib/components/ui/accordion/index.ts',
  publicImport: '$lib/components/ui/accordion',
  legacyImports: [],
  exports: [
    'Accordion',
    'AccordionContent',
    'AccordionHeader',
    'AccordionItem',
    'AccordionTrigger',
    'Content',
    'Header',
    'Item',
    'Root',
    'Trigger',
  ],
  category: 'primitive',
  owner: 'design-system',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/accordion/accordion.test.ts',
  removalGate: 'Retain while exported; disclosure, height motion, and keyboard tests must pass.',
  dynamicImports: [],
  fixtures: accordionFixtures,
} satisfies UiComponentMetadata;
