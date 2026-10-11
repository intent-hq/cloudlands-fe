/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The current-page item retains the source disabled link semantics without a navigable href. */
// Source: src/lib/components/ui/breadcrumb/*.svelte; shadcn breadcrumb composition.
import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { CaretRightIcon, DotsThreeIcon } from '@phosphor-icons/react';
import { m } from '$shared/paraglide/messages.js';
import { cn } from '@/lib/utils';
export function Breadcrumb({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="breadcrumb"
      aria-label={m.ui_breadcrumb_nav_ariaLabel()}
      className={cn('w-full min-w-0 overflow-hidden', className)}
      {...props}
    />
  );
}
export function BreadcrumbList({ className, ...props }: ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn(
        'type-body flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground sm:gap-2',
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-item"
      className={cn('inline-flex min-w-0 items-center gap-1.5', className)}
      {...props}
    />
  );
}
export function BreadcrumbPage({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-page"
      role="link"
      aria-disabled="true"
      aria-current="page"
      className={cn('block min-w-0 truncate font-medium text-foreground', className)}
      {...props}
    />
  );
}
export function BreadcrumbLink({
  asChild = false,
  className,
  ...props
}: ComponentProps<'a'> & { asChild?: boolean }) {
  const Component = asChild ? Slot.Root : 'a';
  return (
    <Component
      data-slot="breadcrumb-link"
      className={cn(
        'block min-w-0 truncate rounded-sm transition-[background-color,color] duration-spring-fast ease-spring-fast hover:bg-hover hover:text-foreground focus-visible:-outline-offset-1 motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}
export function BreadcrumbSeparator({ children, className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn('shrink-0 text-muted-foreground [&>svg]:size-3.5', className)}
      {...props}
    >
      {children ?? <CaretRightIcon aria-hidden="true" weight="regular" />}
    </li>
  );
}
export function BreadcrumbEllipsis({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="breadcrumb-ellipsis"
      role="presentation"
      aria-hidden="true"
      className={cn('flex size-8 shrink-0 items-center justify-center', className)}
      {...props}
    >
      <DotsThreeIcon weight="regular" className="size-4" />
      <span className="sr-only">{m.ui_breadcrumb_more_label()}</span>
    </span>
  );
}
export {
  Breadcrumb as Root,
  BreadcrumbList as List,
  BreadcrumbItem as Item,
  BreadcrumbLink as Link,
  BreadcrumbPage as Page,
  BreadcrumbSeparator as Separator,
  BreadcrumbEllipsis as Ellipsis,
};
