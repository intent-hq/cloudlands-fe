import type { UiComponentMetadata } from '../component-metadata';
import { proximityHighlightFixtures } from './proximity-highlight.fixtures';

export const proximityHighlightMetadata = {
  id: 'proximity-highlight',
  source: 'src/lib/components/ui/proximity-highlight/index.ts',
  publicImport: '$lib/components/ui/proximity-highlight',
  legacyImports: [],
  exports: ['ProximityHighlight'],
  category: 'primitive',
  owner: 'design-system',
  callers: [
    'src/lib/component-catalog/renderers/ProximityHighlightCatalogPreview.svelte',
    'src/lib/components/ui/checkbox-group/checkbox-group.svelte',
    'src/lib/components/ui/radio-group/radio-group.svelte',
    'src/lib/components/ui/toggle-group/toggle-group.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/proximity-highlight/proximity-highlight.test.ts',
  removalGate: 'Retain while shared proximity and merged-selection rendering tests pass.',
  dynamicImports: [],
  fixtures: proximityHighlightFixtures,
} satisfies UiComponentMetadata;
