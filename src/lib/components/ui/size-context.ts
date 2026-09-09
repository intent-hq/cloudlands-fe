import { getContext } from 'svelte';

export type UiSize = 'default' | 'compact';

export const SIZE_CONTEXT = Symbol('ui-size');

/**
 * Returns the nearest control density, falling back to `default` outside a provider.
 * Compact controls are 28px tall and default controls are 36px tall. Components must
 * prefer an explicit `size` prop over this contextual value.
 */
export function useSize(): UiSize {
  return getContext<UiSize>(SIZE_CONTEXT) ?? 'default';
}
