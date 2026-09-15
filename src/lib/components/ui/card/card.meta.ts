import { parseUiComponentMetadata } from '../component-metadata';
import { cardFixtures } from './card.fixtures';

export const cardMetadata = parseUiComponentMetadata({
  id: 'card',
  source: 'src/lib/components/ui/card/card.svelte',
  publicImport: '$lib/components/ui/card',
  legacyImports: [],
  exports: [
    'Action',
    'CARD_CONTENT_INSET_CLASS',
    'CARD_ROW_GUTTER_CLASS',
    'Card',
    'CardAction',
    'CardContent',
    'CardDescription',
    'CardFooter',
    'CardGroup',
    'CardHeader',
    'CardTitle',
    'Content',
    'Description',
    'Footer',
    'Group',
    'Header',
    'Root',
    'Title',
    'cardMetadata',
  ],
  // Minimal composition from the editorial-card default fixture.
  usage: `<script lang="ts">
  import * as Card from '$lib/components/ui/card';
</script>

<Card.Root>
  <Card.Header><Card.Title>Workspace</Card.Title></Card.Header>
  <Card.Content>Workspace details</Card.Content>
</Card.Root>`,
  category: 'pattern',
  owner: '012-E',
  callers: [
    'src/lib/component-catalog/renderers/ContentFieldCatalogPreview.svelte',
    'src/lib/components/patterns/collection/ListRow.svelte',
    'src/lib/components/patterns/screen/EmptyState.svelte',
    'src/lib/components/patterns/screen/LoadingState.svelte',
    'src/routes/sandbox/recipes/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/card/card.test.ts',
  removalGate: 'Retain while reusable editorial surfaces require structured card slots.',
  dynamicImports: [],
  fixtures: cardFixtures,
  useWhen: [
    'Building a structured editorial surface with one canonical horizontal content inset.',
    'Nesting a collection by making Card.Content flush and applying inset to its rows and states.',
  ],
});
