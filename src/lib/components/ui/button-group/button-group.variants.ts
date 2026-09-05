import { tv, type VariantProps } from 'tailwind-variants';

export const buttonGroupVariants = tv({
  base: 'isolate inline-flex items-stretch gap-px rounded-md bg-border p-px',
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
