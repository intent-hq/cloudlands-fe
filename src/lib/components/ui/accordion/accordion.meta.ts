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
  // Minimal composition from the accordion-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as Accordion from '$lib/components/ui/accordion';
</script>

<Accordion.Root value="details">
  <Accordion.Item value="details">
    <Accordion.Header><Accordion.Trigger>Details</Accordion.Trigger></Accordion.Header>
    <Accordion.Content>Accordion details</Accordion.Content>
  </Accordion.Item>
</Accordion.Root>`,
  category: 'primitive',
  owner: 'design-system',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/accordion/accordion.test.ts',
  removalGate: 'Retain while exported; disclosure, height motion, and keyboard tests must pass.',
  dynamicImports: [],
  fixtures: accordionFixtures,
} satisfies UiComponentMetadata;
