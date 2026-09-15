import { parseUiComponentMetadata } from '../component-metadata';
import { selectFixtures } from './select.fixtures';

export const selectMetadata = parseUiComponentMetadata({
  id: 'select',
  source: 'src/lib/components/ui/select/select.svelte',
  publicImport: '$lib/components/ui/select',
  legacyImports: [],
  exports: ['Select'],
  // Minimal composition from the select-state-matrix default fixture.
  usage: `<script lang="ts">
  import { Select } from '$lib/components/ui/select';

  let value = $state('apple');
  const items = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
  ];
</script>

<Select.Root bind:value {items}>
  <Select.Trigger aria-label="Fruit"><Select.Value placeholder="Choose fruit" /></Select.Trigger>
  <Select.Content>
    {#each items as item}
      <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>`,
  category: 'primitive',
  owner: '007-B6',
  callers: [
    'src/lib/component-catalog/renderers/FieldPreviewCell.svelte',
    'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
    'src/lib/components/settings/LinearAuthConnection.svelte',
    'src/lib/components/workspace/initializer/BranchSelector.svelte',
    'src/lib/components/workspace/initializer/RemoteSetupSelector.svelte',
    'src/lib/components/workspace/initializer/RepoSelector.svelte',
    'src/routes/(app)/settings/+page.svelte',
  ],
  replacement: null,
  characterizationTest: 'src/lib/components/ui/select/select.test.ts',
  removalGate: 'Retain while exported and behavior, accessibility, and fixtures pass.',
  dynamicImports: [],
  fixtures: selectFixtures,
});
