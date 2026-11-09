import { tv } from 'tailwind-variants';
import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';
import './menu-overlay.css';

export const menuItem = tv({
  base: `${OPTION_LIST_ROW_CLASS} menu-row group/menu-item relative z-10 flex w-full min-w-0 cursor-default select-none items-start gap-2.5 border-none bg-transparent px-2.5 py-1.5 transition-colors duration-spring-fast ease-spring-fast focus:text-foreground focus-visible:outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-reduce:transition-none`,
  variants: {
    inset: { true: 'pl-8' },
  },
});

export const menuOverlay = tv({
  base: 'menu-overlay type-caption relative isolate z-(--layer-popover) overflow-hidden rounded-(--radius-medium) border border-border bg-popover shadow-(--elevation-overlay) [--menu-icon-size:calc(var(--space-3)+var(--space-1)/2)] [--radius-row:calc(var(--radius-small)-var(--space-1)/2)] focus-visible:border-input focus-visible:outline focus-visible:-outline-offset-1 data-[side=bottom]:origin-top data-[side=top]:origin-bottom data-[side=left]:origin-right data-[side=right]:origin-left data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-spring-moderate data-[state=open]:ease-spring-moderate data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-spring-moderate-exit data-[state=closed]:ease-spring-exit motion-reduce:animate-none motion-reduce:transition-none',
});

/** Values, descriptions and notes in menu rows use the same quiet ink as shortcut hints. */
export const menuDescription = 'text-shortcut-foreground';

// Compensate for p-1/py-1 and the overlay's 1px border so first rows align.
export const menuSubmenuAlignOffset = -5;

export const menuOverlayTransition = {
  enter: { tier: 'moderate', y: 4, scale: 0.95 },
  exit: { tier: 'moderate' },
} as const;
