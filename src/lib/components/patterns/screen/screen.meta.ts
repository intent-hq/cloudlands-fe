import { parsePatternMetadata } from '../pattern-metadata';
import { screenFixtures } from './screen.fixtures';

export const screenMetadata = parsePatternMetadata({
  id: 'screen',
  source: 'src/lib/components/patterns/screen/index.ts',
  publicImport: '$lib/components/patterns/screen',
  exports: [
    'EmptyState',
    'ErrorState',
    'LoadingState',
    'Screen',
    'ScreenBody',
    'ScreenFooter',
    'ScreenHeader',
    'TakeoverScreen',
  ],
  owner: 'design-system',
  fixtures: screenFixtures,
  useWhen: [
    'Building a page-level surface with a stable header, body, and footer.',
    'Building a takeover flow whose body changes height between steps.',
  ],
  dontUseWhen: [
    'Rendering a transient confirmation; use the Confirm pattern instead.',
    'Rendering a repeated collection without page-level structure.',
  ],
  replaces: [
    'Bespoke page and takeover shells.',
    'Repeated panel empty, error, and loading shells.',
  ],
});
