import { getContext, setContext } from 'svelte';
import type { ProximityHover } from '$lib/interaction';

const LIST_PROXIMITY_CONTEXT = Symbol('list-proximity');

export interface ListProximityContext {
  readonly interactive: boolean;
  readonly hover: ProximityHover | null;
  claimIndex(): number;
}

export function setListProximityContext(context: ListProximityContext): void {
  setContext(LIST_PROXIMITY_CONTEXT, context);
}

export function getListProximityContext(): ListProximityContext | undefined {
  return getContext<ListProximityContext>(LIST_PROXIMITY_CONTEXT);
}
