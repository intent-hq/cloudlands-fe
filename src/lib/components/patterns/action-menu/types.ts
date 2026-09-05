import type { IconDefinition } from '$lib/icons/phosphor-icons';

export interface ActionDefinition {
  id: string;
  label: string;
  icon?: IconDefinition;
  shortcut?: string;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  when?: boolean;
  group?: string;
  checked?: boolean;
  children?: readonly ActionDefinition[];
}

export type ActionHandler = (id: string, event: Event) => void;

export interface ActionSplit {
  visible: ActionDefinition[];
  overflow: ActionDefinition[];
}
