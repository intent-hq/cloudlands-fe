import { parsePatternMetadata } from '../pattern-metadata';
import { collectionFixtures } from './collection.fixtures';

export const collectionMetadata = parsePatternMetadata({
  id: 'collection',
  source: 'src/lib/components/patterns/collection/index.ts',
  publicImport: '$lib/components/patterns/collection',
  exports: [
    'ActionDefinition',
    'ActionHandler',
    'DataList',
    'ListRow',
    'ListView',
    'RowActions',
    'SectionedList',
  ],
  owner: 'design-system',
  fixtures: collectionFixtures,
  useWhen: [
    'Rendering repeated rows with consistent pointer and keyboard highlighting.',
    'Rendering selectable, sectioned, virtualized, or key/value collections.',
    'Rendering row commands from the same declarative action definitions as ActionBar.',
  ],
  dontUseWhen: [
    'Rendering a data table whose columns need sorting and resizing.',
    'Rendering a visual card grid with two-dimensional navigation.',
  ],
  replaces: [
    'Bespoke settings rows and hover action wrappers.',
    'The legacy UI List composition for new product collection surfaces.',
  ],
});
