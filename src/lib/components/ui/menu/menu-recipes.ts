import { tv } from 'tailwind-variants';
import { OPTION_LIST_ROW_CLASS } from '$lib/styles/option-list-row';

export const menuItem = tv({
  base: `${OPTION_LIST_ROW_CLASS} group/menu-item relative z-10 flex w-full min-w-0 cursor-default select-none items-center gap-2 border-none bg-transparent text-left transition-[color,font-weight] duration-spring-fast ease-spring-fast focus:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-focus-ring focus-visible:shadow-none data-[highlighted]:[--text-caption-weight:500] data-[selected]:[--text-caption-weight:500] data-[state=checked]:[--text-caption-weight:500] data-[state=open]:[--text-caption-weight:500] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-reduce:transition-none`,
  variants: {
    inset: { true: 'pl-8' },
  },
});

export const menuOverlay = tv({
  base: 'type-body relative isolate z-(--layer-popover) overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-(--elevation-overlay) focus-visible:border-input focus-visible:outline focus-visible:-outline-offset-1 data-[side=bottom]:origin-top data-[side=top]:origin-bottom data-[side=left]:origin-right data-[side=right]:origin-left data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:duration-spring-moderate data-[state=open]:ease-spring-moderate data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-spring-moderate-exit data-[state=closed]:ease-spring-exit motion-reduce:animate-none motion-reduce:transition-none',
});

export const menuOverlayTransition = {
  enter: { tier: 'moderate', y: 4, scale: 0.95 },
  exit: { tier: 'moderate' },
} as const;
