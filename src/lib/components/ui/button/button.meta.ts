import { parseUiComponentMetadata } from '../component-metadata';
import { buttonFixtures } from './button.fixtures';
import {
  buttonCompatibilityAliases,
  buttonEmphasisLadder,
  buttonSizeLadder,
} from './button.variants';

export const buttonMetadata = parseUiComponentMetadata({
  id: 'button',
  source: 'src/lib/components/ui/button/button.svelte',
  publicImport: '$lib/components/ui/button',
  legacyImports: ['$lib/components/ui/button/button.svelte', '$lib/components/ui/button/index.js'],
  exports: ['Button', 'ButtonVariant'],
  category: 'primitive',
  owner: '007-B1',
  callers: [
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
    'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/ScreenStatesCatalogPreview.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/button/button.test.ts',
  removalGate:
    'Retain while exported and behavior, accessibility, shared loading indicator, and fixtures pass.',
  dynamicImports: [],
  fixtures: buttonFixtures,
  useWhen: ['Triggering an immediate action with explicit emphasis and accessible labeling.'],
  dontUseWhen: ['Navigating to another location; use a link instead.'],
  apiGuidance: {
    emphasis: buttonEmphasisLadder,
    sizes: buttonSizeLadder,
    compatibilityAliases: buttonCompatibilityAliases,
  },
});
