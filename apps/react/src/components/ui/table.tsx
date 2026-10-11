// Source: src/lib/components/ui/table/*.svelte; shadcn table composition.
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
export function Table({ className, ...props }: ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto rounded-(--radius-large)"
    >
      <table
        data-slot="table"
        className={cn('type-caption w-full caption-bottom border-collapse', className)}
        {...props}
      />
    </div>
  );
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  );
}
export function TableFooter({ className, ...props }: ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-hover font-medium', className)}
      {...props}
    />
  );
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'h-8 border-b border-border transition-colors duration-(--motion-fast) hover:bg-hover data-[state=selected]:bg-selected focus-within:bg-hover motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  );
}
export function TableHead({ className, ...props }: ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn('h-8 px-2 text-left align-middle font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('h-8 px-2 py-1.5 align-middle tabular-nums', className)}
      {...props}
    />
  );
}
export function TableCaption({ className, ...props }: ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('type-caption mt-3 text-muted-foreground', className)}
      {...props}
    />
  );
}
export {
  Table as Root,
  TableHeader as Header,
  TableBody as Body,
  TableFooter as Footer,
  TableRow as Row,
  TableHead as Head,
  TableCell as Cell,
  TableCaption as Caption,
};
