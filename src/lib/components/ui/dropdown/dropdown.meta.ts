import { parseUiComponentMetadata } from '../component-metadata';
import { dropdownFixtures } from './dropdown.fixtures';

export const dropdownMetadata = parseUiComponentMetadata({
  id: 'dropdown',
  source: 'src/lib/components/ui/dropdown/Dropdown.svelte',
  publicImport: '$lib/components/ui/dropdown',
  legacyImports: [],
  exports: [
    'Dropdown',
    'DropdownGroup',
    'DropdownGroupProps',
    'DropdownItemProps',
    'DropdownOption',
  ],
  category: 'deprecated-wrapper',
  owner: '007-B6',
  callers: [
    'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    'src/lib/component-catalog/renderers/PopoversCatalogPreview.svelte',
    'src/lib/components/chat/input/ModelPicker.svelte',
    'src/lib/components/chat/input/ModelPickerGroupHeader.svelte',
    'src/lib/components/chat/input/ModelPickerOptionItem.svelte',
    'src/lib/components/chat/input/model-picker-groups.ts',
    'src/lib/components/chat/input/model-picker-utils.ts',
    'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte',
    'src/lib/components/patterns/settings/custom-controls.ts',
  ],
  replacement: 'ledger:src/lib/components/ui/dropdown/dropdown-caller-ledger.ts',
  characterizationTest: 'src/lib/components/ui/dropdown/Dropdown.test.ts',
  removalGate: 'All static and dynamic callers migrate and replacement behavior tests pass.',
  dynamicImports: [],
  fixtures: dropdownFixtures,
});
