import type { UiSize } from '$lib/components/ui/size-context';

const forcedStateClasses =
  'data-[state=hover]:bg-hover data-[state=focus]:bg-card data-[state=focus]:shadow-[inset_0_0_0_1px_var(--ring)]';

export const textEntryControlClasses = `border-border bg-transparent shadow-none transition-[background-color,border-color,box-shadow,color] duration-(--spring-fast) hover:bg-hover focus-visible:bg-card ${forcedStateClasses} read-only:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-60 disabled:hover:bg-transparent aria-invalid:border-danger motion-reduce:transition-none`;

export const textEntryGroupClasses = `border-border bg-transparent shadow-none outline-none transition-[background-color,border-color,box-shadow,color] duration-(--spring-fast) hover:bg-hover focus-within:bg-card focus-within:shadow-[inset_0_0_0_1px_var(--ring)] focus-within:outline-none focus-within:ring-0 ${forcedStateClasses} data-[disabled=true]:pointer-events-none data-[disabled=true]:bg-transparent data-[disabled=true]:opacity-60 data-[disabled=true]:hover:bg-transparent data-[invalid=true]:border-danger motion-reduce:transition-none`;

export const textEntryFocusResetClasses =
  'focus-visible:!bg-transparent focus-visible:!shadow-none focus-visible:outline-none';

export function textEntryHeight(size: UiSize): string {
  return size === 'compact' ? 'h-(--control-height-small)' : 'h-(--control-height-medium)';
}
