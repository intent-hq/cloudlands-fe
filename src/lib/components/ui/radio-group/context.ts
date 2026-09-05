import type { ChoiceGroupState } from '../choice-group-state.svelte';

export const RADIO_GROUP_CONTEXT = Symbol('radio-group');

export interface RadioGroupContext {
  readonly state: ChoiceGroupState;
  readonly value: string;
  readonly disabled: boolean;
}
