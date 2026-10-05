import { parseUiComponentMetadata } from '../component-metadata';
import { sliderFixtures } from './slider.fixtures';

export const sliderMetadata = parseUiComponentMetadata({
  id: 'slider',
  source: 'src/lib/components/ui/slider/slider.svelte',
  publicImport: '$lib/components/ui/slider',
  legacyImports: [],
  exports: ['Slider', 'sliderMetadata'],
  category: 'primitive',
  owner: '008-B',
  callers: [
    'src/features/hud/components/HudHeader.svelte',
    'src/lib/components/agent-overview/TimeScrubber.svelte',
    'src/lib/component-catalog/ChatPolishGeometryControls.svelte',
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
    'src/lib/component-catalog/renderers/SettingsCatalogPreview.svelte',
    'src/lib/components/settings/AgentBackendSettings.svelte',
    'src/lib/components/settings/NotificationSettings.svelte',
    'src/lib/components/ui/ZoomPanViewport.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/slider/slider.test.ts',
  removalGate:
    'Retain while native range, pointer, keyboard, discrete step, and editing tests pass.',
  dynamicImports: [],
  fixtures: sliderFixtures,
});
