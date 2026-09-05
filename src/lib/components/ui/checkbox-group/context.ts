import type { ChoiceGroupState } from '../choice-group-state.svelte';

export const CHECKBOX_GROUP_CONTEXT = Symbol('checkbox-group');

export interface CheckboxGroupContext {
  readonly state: ChoiceGroupState;
  readonly value: readonly string[];
  readonly name: string | undefined;
  readonly disabled: boolean;
  readonly layout: 'inline' | 'stacked';
  setChecked(value: string, checked: boolean): void;
}
