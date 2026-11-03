import type { UiSize } from '$lib/components/ui/size-context';

const forcedStateClasses = 'data-[state=hover]:bg-hover';

export const textEntryControlClasses = `border-border bg-transparent shadow-none transition-[background-color,border-color,box-shadow,color] duration-(--spring-fast) hover:bg-hover ${forcedStateClasses} read-only:text-muted-foreground disabled:cursor-not-allowed disabled:bg-transparent disabled:opacity-60 disabled:hover:bg-transparent aria-invalid:border-danger motion-reduce:transition-none`;

export const textEntryGroupClasses = `border-border bg-transparent shadow-none outline-none transition-[background-color,border-color,box-shadow,color] duration-(--spring-fast) hover:bg-hover focus-within:outline-none focus-within:ring-0 ${forcedStateClasses} data-[disabled=true]:pointer-events-none data-[disabled=true]:bg-transparent data-[disabled=true]:opacity-60 data-[disabled=true]:hover:bg-transparent data-[invalid=true]:border-danger motion-reduce:transition-none`;

export const textEntryFocusResetClasses =
  'focus-visible:!bg-transparent focus-visible:!shadow-none focus-visible:outline-none';

// Caret-bearing controls indicate focus through their caret, not an outer box.
// Keep separate from the shared control recipe so file-picker focus is preserved.
export const textEntryCaretFocusClasses = 'focus-visible:outline-none focus-visible:shadow-none';

export function textEntryHeight(size: UiSize): string {
  return size === 'compact' ? 'h-(--control-height-small)' : 'h-(--control-height-medium)';
}

/**
 * Menu and picker search: one flat, body-sized field on the popover surface.
 * Transparent surface, light placeholder, and caret focus without an outer box.
 */
export const textEntrySearchClasses =
  'type-body h-9 w-full min-w-0 rounded-(--radius-medium) border-0 bg-transparent px-3 text-foreground placeholder:text-muted-foreground/60! shadow-none outline-none ring-0 hover:bg-transparent focus-visible:bg-transparent focus-visible:shadow-none focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:ring-1 aria-invalid:ring-danger';

export type TextEntryVariant = 'default' | 'search';
