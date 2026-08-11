import { tv, type VariantProps } from 'tailwind-variants';

export const buttonGroupVariants = tv({
  base: 'isolate inline-flex items-stretch gap-px rounded-md border border-border bg-border p-px shadow-xs',
  variants: {
    orientation: {
      horizontal: 'flex-row',
      vertical: 'flex-col',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

export type ButtonGroupVariant = VariantProps<typeof buttonGroupVariants>;
