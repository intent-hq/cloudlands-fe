type DropdownReplacement = 'Menu' | 'Select' | 'Combobox';

export interface DropdownCallerLedgerEntry {
  caller: string;
  replacement: DropdownReplacement;
  reason: string;
}

export const dropdownCallerLedger = [
  {
    caller: 'src/lib/component-catalog/renderers/ChoiceCatalogPreview.svelte',
    replacement: 'Combobox',
    reason: 'catalog characterization of the deprecated value-selection wrapper',
  },
  {
    caller: 'src/lib/components/chat/input/ModelPicker.svelte',
    replacement: 'Combobox',
    reason: 'searchable grouped value selection',
  },
  {
    caller: 'src/lib/components/chat/input/ModelPickerGroupHeader.svelte',
    replacement: 'Combobox',
    reason: 'group header support for ModelPicker',
  },
  {
    caller: 'src/lib/components/chat/input/model-picker-groups.ts',
    replacement: 'Combobox',
    reason: 'grouped option model for ModelPicker',
  },
  {
    caller: 'src/lib/components/chat/input/model-picker-utils.ts',
    replacement: 'Combobox',
    reason: 'searchable option model for ModelPicker',
  },
  {
    caller: 'src/lib/components/layout/sidebar-nav/cards/ChiefCard.svelte',
    replacement: 'Select',
    reason: 'non-searchable single-value selection',
  },
  {
    caller: 'src/lib/components/chat/input/ModelPickerOptionItem.svelte',
    replacement: 'Combobox',
    reason: 'shared option model for ModelPicker',
  },
  {
    caller: 'src/lib/components/patterns/settings/custom-controls.ts',
    replacement: 'Menu',
    reason: 'settings bridge for action items and separator without value selection',
  },
] as const satisfies readonly DropdownCallerLedgerEntry[];
