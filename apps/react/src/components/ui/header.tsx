import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export interface HeaderProps extends HTMLAttributes<HTMLHeadingElement> {
  size?: 1 | 2 | 3 | 4 | 5 | 6;
}

const headingClasses = {
  1: 'text-2xl font-semibold leading-tight tracking-tight antialiased',
  2: 'text-xl font-semibold leading-tight tracking-tight antialiased',
  3: 'text-xs font-medium text-muted-foreground antialiased',
  4: 'text-xs font-medium text-subtle antialiased',
  5: 'text-sm font-medium leading-normal antialiased',
  6: 'text-[0.66rem] font-medium text-muted-foreground antialiased',
} as const;

export function Header({ size = 1, className, children, ...props }: HeaderProps) {
  const Heading = `h${size}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
  return (
    <Heading className={cn(headingClasses[size], className)} {...props}>
      {children ?? props.title}
    </Heading>
  );
}
