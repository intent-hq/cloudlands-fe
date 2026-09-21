import type { ChoiceGroupState } from '../choice-group-state.svelte';
import type { UiSize } from '$lib/components/ui/size-context';

export type TabsVariant = 'default' | 'subtle';

export const TABS_CONTEXT = Symbol('tabs');

export interface TabsContext {
  state: ChoiceGroupState;
  readonly value: string;
  readonly variant: TabsVariant;
  readonly size: UiSize;
  readonly disabled: boolean;
}
