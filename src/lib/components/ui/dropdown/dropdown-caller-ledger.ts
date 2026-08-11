export type DropdownReplacement = 'Menu' | 'Select' | 'Combobox';

export interface DropdownCallerLedgerEntry {
  caller: string;
  replacement: DropdownReplacement;
  reason: string;
}

export const dropdownCallerLedger = [
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
    caller: 'src/lib/components/settings/mcp/McpServerCard.svelte',
    replacement: 'Menu',
    reason: 'action items and separator without value selection',
  },
] as const satisfies readonly DropdownCallerLedgerEntry[];
