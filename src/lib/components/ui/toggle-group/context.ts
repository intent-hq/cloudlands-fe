import type { ChoiceGroupState } from '../choice-group-state.svelte';

export const TOGGLE_GROUP_CONTEXT = Symbol('toggle-group');

export interface ToggleGroupContext {
  readonly state: ChoiceGroupState;
  readonly size?: 'default' | 'xs' | 'sm' | 'lg' | null;
  readonly variant?: 'default' | 'outline' | 'flat' | null;
}
