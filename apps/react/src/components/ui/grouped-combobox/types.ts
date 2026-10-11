import type { ComboboxGroup, ComboboxOption } from '@/components/ui/combobox';

export interface GroupedOption extends ComboboxOption {}
export interface OptionGroup extends ComboboxGroup {
  options: GroupedOption[];
}
