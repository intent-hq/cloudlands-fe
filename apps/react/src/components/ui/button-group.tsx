/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Keep the source non-fieldset action group and its div ref contract. */
// Source: src/lib/components/ui/button-group; shadcn group with Intent geometry.
import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import './button-group.css';
export const buttonGroupVariants = cva(
  'isolate inline-flex items-stretch gap-px rounded-md bg-sidebar p-px',
  {
    variants: { orientation: { horizontal: 'flex-row', vertical: 'flex-col' } },
    defaultVariants: { orientation: 'horizontal' },
  },
);
export type ButtonGroupVariant = VariantProps<typeof buttonGroupVariants>;
export function ButtonGroup({
  className,
  orientation = 'horizontal',
  ...props
}: ComponentProps<'div'> & ButtonGroupVariant) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(
        buttonGroupVariants({ orientation }),
        '[&_[data-slot=button]]:rounded-sm [&_[data-slot=button]]:border-transparent',
        '[&_[data-slot=button-surface]]:rounded-[inherit]',
        '[&_[data-slot=button]:hover]:z-10 [&_[data-slot=button]:focus-visible]:z-20',
        '[&_[data-slot=button][data-state=active]]:z-10',
        className,
      )}
      {...props}
    />
  );
}
export { ButtonGroup as Root };
