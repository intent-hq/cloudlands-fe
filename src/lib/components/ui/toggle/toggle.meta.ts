import type { UiComponentMetadata } from '../component-metadata';
import { toggleFixtures } from './toggle.fixtures';

export const toggleCompatibilityModes = {
  group: {
    replacement: '$lib/components/ui/toggle-group',
    callers: [],
    staticUsageCount: 0,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="group" usage counts both reach zero.',
  },
  switch: {
    replacement: '$lib/components/ui/switch',
    callers: [],
    staticUsageCount: 0,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="switch" usage counts both reach zero.',
  },
  indicator: {
    replacement: '$lib/components/ui/switch',
    callers: [],
    staticUsageCount: 0,
    dynamicUsageCount: 0,
    removalGate:
      'Remove only when source-derived static and dynamic variant="indicator" usage counts both reach zero.',
  },
} as const;
export const toggleMetadata = {
  id: 'toggle',
  source: 'src/lib/components/ui/toggle/index.ts',
  publicImport: '$lib/components/ui/toggle',
  legacyImports: [],
  exports: ['Toggle'],
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/patterns/settings/custom-controls.ts',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/toggle/toggle.test.ts',
  removalGate: 'Retain canonical aria-pressed Toggle.',
  dynamicImports: [],
  fixtures: toggleFixtures,
} satisfies UiComponentMetadata;
