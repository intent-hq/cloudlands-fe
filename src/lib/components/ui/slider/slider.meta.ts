import { parseUiComponentMetadata } from '../component-metadata';
import { sliderFixtures } from './slider.fixtures';

export const sliderMetadata = parseUiComponentMetadata({
  id: 'slider',
  source: 'src/lib/components/ui/slider/slider.svelte',
  publicImport: '$lib/components/ui/slider',
  legacyImports: [],
  exports: ['Root', 'Slider', 'sliderMetadata'],
  category: 'primitive',
  owner: '008-B',
  callers: [
    'src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte',
    'src/lib/components/settings/AgentBackendSettings.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/slider/slider.test.ts',
  removalGate: 'Retain while exported and native range, accessibility, and fixture tests pass.',
  dynamicImports: [],
  fixtures: sliderFixtures,
});
