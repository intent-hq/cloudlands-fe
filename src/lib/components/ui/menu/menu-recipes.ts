import { tv } from 'tailwind-variants';

export const menuItem = tv({
  base: 'group/menu-item type-caption relative z-10 flex min-h-(--control-height-medium) w-full min-w-0 cursor-default select-none items-center gap-2 rounded-(--radius-row) border-none bg-transparent px-2 py-1 text-left outline-none transition-[color,font-weight] duration-spring-fast ease-spring-fast focus:text-foreground data-[highlighted]:[--text-caption-weight:500] data-[selected]:[--text-caption-weight:500] data-[state=checked]:[--text-caption-weight:500] data-[state=open]:[--text-caption-weight:500] data-[disabled]:pointer-events-none data-[disabled]:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 motion-reduce:transition-none',
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
