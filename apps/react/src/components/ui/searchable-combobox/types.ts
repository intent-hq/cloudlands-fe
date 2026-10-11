import type { ComboboxOption } from '@/components/ui/combobox';

export interface Option extends ComboboxOption {}

export interface ItemActionContext {
  option: Option;
  isRenaming: boolean;
  renameValue: string;
  startRename: () => void;
  cancelRename: () => void;
  commitRename: (newName: string) => void;
}
