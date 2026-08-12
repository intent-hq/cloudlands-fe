import { parseUiComponentMetadata } from '../component-metadata';
import { buttonFixtures } from './button.fixtures';

export const buttonMetadata = parseUiComponentMetadata({
  id: 'button',
  source: 'src/lib/components/ui/button/button.svelte',
  publicImport: '$lib/components/ui/button',
  legacyImports: ['$lib/components/ui/button/button.svelte', '$lib/components/ui/button/index.js'],
  exports: [
    'Button',
    'ButtonProps',
    'ButtonSize',
    'ButtonVariant',
    'Props',
    'Root',
    'buttonMetadata',
    'buttonVariants',
  ],
  category: 'primitive',
  owner: '007-B1',
  callers: [],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/button/button.test.ts',
  removalGate: 'Retain while exported and behavior, accessibility, and fixtures pass.',
  dynamicImports: [],
  fixtures: buttonFixtures,
});
