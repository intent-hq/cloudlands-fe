import type { UiComponentMetadata } from '../component-metadata';
import { toggleGroupFixtures } from './toggle-group.fixtures';

export const toggleGroupMetadata = {
  id: 'toggle-group',
  source: 'src/lib/components/ui/toggle-group/index.ts',
  publicImport: '$lib/components/ui/toggle-group',
  legacyImports: [],
  exports: ['Item', 'Root', 'ToggleGroup', 'ToggleGroupItem'],
  // Minimal composition from the toggle-group-state-matrix default fixture.
  usage: `<script lang="ts">
  import * as ToggleGroup from '$lib/components/ui/toggle-group';
</script>

<ToggleGroup.Root type="single" value="left" aria-label="Alignment">
  <ToggleGroup.Item value="left" aria-label="Align left">Left</ToggleGroup.Item>
  <ToggleGroup.Item value="right" aria-label="Align right">Right</ToggleGroup.Item>
</ToggleGroup.Root>`,
  category: 'primitive',
  owner: '007-B2',
  callers: [
    'src/lib/component-catalog/CatalogControls.svelte',
    'src/lib/component-catalog/renderers/BasicCatalogPreview.svelte',
    'src/lib/components/patterns/settings/custom-controls.ts',
    'src/lib/components/workspace/initializer/AddRemoteSetupModal.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/toggle-group/toggle-group.test.ts',
  removalGate: 'Retain while exported; single, multiple, and keyboard behavior tests must pass.',
  dynamicImports: [],
  fixtures: toggleGroupFixtures,
} satisfies UiComponentMetadata;
