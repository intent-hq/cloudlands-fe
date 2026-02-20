export interface Option {
  value: string;
  label: string;
  description?: string;
  icon?: any;
  data?: any;
  class?: string;
}

/** Context passed to itemActions snippet for handling rename inline */
export interface ItemActionContext {
  option: Option;
  isRenaming: boolean;
  renameValue: string;
  startRename: () => void;
  cancelRename: () => void;
  commitRename: (newName: string) => void;
}
