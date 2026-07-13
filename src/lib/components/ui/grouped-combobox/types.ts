export interface GroupedOption {
  value: string;
  label: string;
  description?: string;
  icon?: any;
  data?: any;
}

export interface OptionGroup {
  key: string;
  label: string;
  icon?: any;
  options: GroupedOption[];
  data?: any;
}
