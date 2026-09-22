import type { IconDefinition } from '$lib/icons/phosphor-icons';

interface ActionBase {
  id: string;
  label: string;
  icon?: IconDefinition;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  when?: boolean;
  group?: string;
  /** Optional command identity, used to reject duplicate targets in the same scope. */
  commandId?: string;
  closeOnSelect?: boolean;
}

interface CommandAction extends ActionBase {
  kind: 'action';
  destructive?: boolean;
  checked?: never;
  children?: never;
}

interface CheckboxAction extends ActionBase {
  kind: 'checkbox';
  checked: boolean;
  indeterminate?: boolean;
  destructive?: never;
  children?: never;
}

export interface RadioAction extends ActionBase {
  kind: 'radio';
  value: string;
  checked?: never;
  destructive?: never;
  children?: never;
}

interface RadioGroupAction extends ActionBase {
  kind: 'radio-group';
  value: string;
  children: readonly RadioAction[];
  checked?: never;
  destructive?: never;
}

interface ContainerAction extends ActionBase {
  kind: 'submenu' | 'section';
  children: readonly ActionDefinition[];
  checked?: never;
  destructive?: never;
}

/** Compatibility for existing command arrays. New definitions should specify kind. */
interface LegacyAction extends ActionBase {
  kind?: undefined;
  destructive?: boolean;
  checked?: boolean;
  children?: readonly ActionDefinition[];
}

export type ActionDefinition =
  CommandAction | CheckboxAction | RadioGroupAction | ContainerAction | LegacyAction;

export type ResolvedAction = ActionDefinition | RadioAction;

export type ActionHandler = (id: string, event: Event) => void;

export interface ActionSplit {
  visible: ActionDefinition[];
  overflow: ActionDefinition[];
}
