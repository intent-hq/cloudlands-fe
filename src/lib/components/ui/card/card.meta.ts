import { parseUiComponentMetadata } from '../component-metadata';
import { cardFixtures } from './card.fixtures';

export const cardMetadata = parseUiComponentMetadata({
  id: 'card',
  source: 'src/lib/components/ui/card/card.svelte',
  publicImport: '$lib/components/ui/card',
  legacyImports: [],
  exports: [
    'Action',
    'Card',
    'CardAction',
    'CardContent',
    'CardDescription',
    'CardFooter',
    'CardHeader',
    'CardTitle',
    'Content',
    'Description',
    'Footer',
    'Header',
    'Root',
    'Title',
    'cardMetadata',
  ],
  category: 'pattern',
  owner: '012-E',
  callers: ['src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte'],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/card/card.test.ts',
  removalGate: 'Retain while reusable editorial surfaces require structured card slots.',
  dynamicImports: [],
  fixtures: cardFixtures,
});
