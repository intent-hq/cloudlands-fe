import type { HTMLAttributes, ReactNode } from 'react';
import { useSize } from '@/components/ui/size-context';
import { CARD_ROW_GUTTER_CLASS } from '@/components/ui/card';
import { cn } from '@/lib/utils';
export { ListView, type ListViewProps } from './list-view';

export type {
  DataListItem,
  ListKey,
  ListRowContext,
  SelectionMode,
} from '$lib/components/patterns/collection/types';
import type { DataListItem, ListKey } from '$lib/components/patterns/collection/types';

export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  inset?: boolean;
}

export function ListRow({
  leading,
  title,
  description,
  meta,
  trailing,
  inset = false,
  className,
  ...props
}: ListRowProps) {
  const density = useSize();
  return (
    <div
      data-slot="list-row"
      data-density={density}
      data-inset={inset ? 'card' : undefined}
      className={cn(
        'flex min-w-0 items-start gap-3',
        inset ? CARD_ROW_GUTTER_CLASS : 'px-3',
        density === 'compact' ? 'min-h-9 py-1.5' : 'min-h-12 py-2.5',
        className,
      )}
      {...props}
    >
      {leading != null && (
        <div data-slot="list-row-leading" className="type-caption first-line-icon">
          {leading}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <div data-slot="list-row-title" className="min-w-0 truncate type-caption text-foreground">
            {title}
          </div>
          {meta != null && (
            <div className="shrink-0 type-caption text-muted-foreground">{meta}</div>
          )}
        </div>
        {description != null && (
          <div className="mt-0.5 min-w-0 type-caption text-muted-foreground">{description}</div>
        )}
      </div>
      {trailing != null && (
        <div data-slot="list-row-trailing" className="type-caption first-line-icon gap-1">
          {trailing}
        </div>
      )}
    </div>
  );
}

export interface SectionedListProps<T> {
  sections: readonly T[];
  getKey?: (section: T, index: number) => ListKey;
  header: (section: T, index: number) => ReactNode;
  children: (section: T, index: number) => ReactNode;
  className?: string;
  inset?: boolean;
}

export function SectionedList<T>({
  sections,
  getKey = (_section, index) => index,
  header,
  children,
  className,
  inset = true,
}: SectionedListProps<T>) {
  return (
    <div data-slot="sectioned-list" className={cn('min-w-0', className)}>
      {sections.map((section, index) => (
        <section key={getKey(section, index)} className="min-w-0">
          <div
            className={cn(
              'sticky top-0 z-20 bg-background/95 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm',
              inset ? 'px-3' : 'px-0',
            )}
          >
            {header(section, index)}
          </div>
          {children(section, index)}
        </section>
      ))}
    </div>
  );
}

export interface DataListProps {
  items: readonly DataListItem[];
  value?: (item: DataListItem, index: number) => ReactNode;
  className?: string;
}

export function DataList({ items, value, className }: DataListProps) {
  return (
    <dl data-slot="data-list" className={cn('min-w-0 divide-y divide-border', className)}>
      {items.map((item, index) => (
        <div
          key={item.key}
          className="grid min-w-0 grid-cols-[minmax(7rem,1fr)_minmax(0,2fr)] gap-4 py-2.5"
        >
          <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 text-sm text-foreground">
            {value ? (
              value(item, index)
            ) : (
              <>
                <span className="break-words">{item.value}</span>
                {item.description && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.description}</p>
                )}
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
