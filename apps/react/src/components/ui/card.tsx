// Source: src/lib/components/ui/card/*.svelte; shadcn composition with Intent surfaces and groups.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { ProximityHighlight, createProximityHover, type ProximityHover } from '@/lib/interaction';
import { clampSurface, SurfaceProvider, surfaceClasses, useSurface } from './surface-context';
import { CARD_CONTENT_INSET_CLASS } from '$lib/components/ui/card/card-inset';
import './card.css';
export {
  CARD_CONTENT_INSET_CLASS,
  CARD_ROW_GUTTER_CLASS,
} from '$lib/components/ui/card/card-inset';

interface GroupOptions {
  orientation: 'card' | 'inline';
  border: 'none' | 'outlined';
  separated: boolean;
}
const CardGroupContext = createContext<GroupOptions | undefined>(undefined);
const hoverClasses = [
  'hover:bg-surface-1 hover:shadow-surface-1',
  'hover:bg-surface-2 hover:shadow-surface-2',
  'hover:bg-surface-3 hover:shadow-surface-3',
  'hover:bg-surface-4 hover:shadow-surface-4',
  'hover:bg-surface-5 hover:shadow-surface-5',
  'hover:bg-surface-6 hover:shadow-surface-6',
  'hover:bg-surface-7 hover:shadow-surface-7',
  'hover:bg-surface-8 hover:shadow-surface-8',
];
export type CardProps = ComponentProps<'div'> & {
  interactive?: boolean;
  level?: number;
  border?: GroupOptions['border'];
  selected?: boolean;
  media?: ReactNode;
};
export function Card({
  className,
  inert = false,
  interactive = false,
  level,
  border,
  selected = false,
  media,
  children,
  ...props
}: CardProps) {
  const group = useContext(CardGroupContext);
  const substrate = useSurface();
  const [surface] = useState(() => clampSurface(level ?? substrate + 1));
  const outlined =
    border === 'outlined' ||
    (border === undefined && (!group || (group.border === 'outlined' && group.separated)));
  return (
    <SurfaceProvider level={surface}>
      <div
        data-slot="card"
        data-selected={selected || undefined}
        data-orientation={group?.orientation}
        data-surface-level={surface}
        data-inert={inert || undefined}
        data-interactive={interactive || undefined}
        inert={inert}
        className={cn(
          'flex min-w-0 flex-col overflow-hidden rounded-md text-card-foreground',
          outlined
            ? group
              ? 'border border-border bg-transparent'
              : surfaceClasses(surface)
            : 'bg-transparent',
          selected && 'bg-selected',
          group?.orientation === 'inline' &&
            'flex-row items-center [&>[data-slot=card-header]]:min-w-0 [&>[data-slot=card-header]]:flex-1',
          group && 'relative',
          interactive &&
            cn(
              'cursor-pointer transition-[background-color,box-shadow] duration-(--motion-fast) ease-(--ease-standard)',
              'focus-visible:outline focus-visible:-outline-offset-1',
              'active:bg-active data-[state=pressed]:bg-active motion-reduce:transition-none',
              hoverClasses[clampSurface(surface + 1) - 1],
            ),
          className,
        )}
        {...props}
      >
        {media && <CardMedia>{media}</CardMedia>}
        {children}
      </div>
    </SurfaceProvider>
  );
}
export function CardGroup({
  ref,
  orientation = 'card',
  columns = 1,
  border = 'none',
  separated = false,
  divided = true,
  fluidHover = true,
  selected = -1,
  className,
  style,
  children,
  ...props
}: ComponentProps<'div'> &
  Partial<GroupOptions> & {
    columns?: number;
    divided?: boolean;
    fluidHover?: boolean;
    selected?: number;
  }) {
  const root = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<ProximityHover | null>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const instance = createProximityHover(node, { axis: 'xy' });
    setHover(instance);
    let count = 0;
    const sync = () => {
      const cards = node.querySelectorAll<HTMLElement>(':scope > [data-slot=card]');
      for (let index = cards.length; index < count; index++) instance.registerItem(index, null);
      count = cards.length;
      cards.forEach((card, index) => instance.registerItem(index, card));
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(node, { childList: true });
    return () => {
      observer.disconnect();
      instance.destroy();
    };
  }, []);
  return (
    <CardGroupContext value={{ orientation, border, separated }}>
      <div
        ref={(node) => {
          root.current = node;
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        data-slot="card-group"
        data-separated={separated || undefined}
        data-divided={(divided && !separated) || undefined}
        className={cn(
          'relative isolate grid min-w-0 overflow-hidden rounded-(--radius-large)',
          separated && 'gap-3',
          border === 'outlined' && !separated && 'border border-border',
          className,
        )}
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.floor(columns))}, minmax(0, 1fr))`,
          ...style,
        }}
        {...props}
      >
        {hover && (
          <ProximityHighlight
            store={hover}
            hoverClass={fluidHover ? 'bg-hover' : 'bg-transparent'}
            selectedIndexes={selected < 0 ? [] : [selected]}
          />
        )}
        {children}
      </div>
    </CardGroupContext>
  );
}
export function CardMedia({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-media" className={cn('shrink-0 p-4', className)} {...props} />;
}
export function CardContent({
  className,
  flush = false,
  ...props
}: ComponentProps<'div'> & { flush?: boolean }) {
  return (
    <div
      data-slot="card-content"
      data-flush={flush || undefined}
      className={cn(
        'type-body min-w-0',
        flush ? 'p-0' : cn(CARD_CONTENT_INSET_CLASS, 'py-4 first:pt-4'),
        className,
      )}
      {...props}
    />
  );
}
export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-x-4 gap-y-1.5 pt-4 pb-2 has-data-[slot=card-action]:grid-cols-[minmax(0,1fr)_auto]',
        CARD_CONTENT_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}
export function CardTitle({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        'type-title min-w-0 break-words font-semibold leading-tight text-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="card-description"
      className={cn(
        'type-caption min-w-0 break-words leading-snug text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function CardAction({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        'type-body col-start-2 row-span-2 row-start-1 max-w-full self-start justify-self-end',
        className,
      )}
      {...props}
    />
  );
}
export function CardFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'type-caption flex min-w-0 flex-wrap items-center gap-2 pb-4 pt-2 text-muted-foreground',
        CARD_CONTENT_INSET_CLASS,
        className,
      )}
      {...props}
    />
  );
}
export {
  Card as Root,
  Card as CardRoot,
  CardGroup as Group,
  CardHeader as Header,
  CardTitle as Title,
  CardDescription as Description,
  CardAction as Action,
  CardContent as Content,
  CardFooter as Footer,
  CardMedia as Media,
};
