// Source: src/lib/components/ui/accordion/*.svelte; shadcn Radix semantics and shared height motion.
import { createContext, useContext, useRef, useState, type ComponentProps } from 'react';
import { Accordion as AccordionPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';
import { useAnimatedHeight } from '@/lib/motion';
import { useSize } from './size-context';

const AccordionValue = createContext<readonly string[]>([]);
const AccordionOpen = createContext(false);
type Common = Omit<
  ComponentProps<typeof AccordionPrimitive.Root>,
  'type' | 'value' | 'defaultValue' | 'onValueChange'
> & { loop?: boolean; collapsible?: boolean };
export type AccordionProps = Common &
  (
    | {
        type?: 'single';
        value?: string;
        defaultValue?: string;
        onValueChange?: (value: string) => void;
      }
    | {
        type: 'multiple';
        value?: string[];
        defaultValue?: string[];
        onValueChange?: (value: string[]) => void;
      }
  );
export function Accordion({ className, loop = true, onKeyDown, ...props }: AccordionProps) {
  const [internal, setInternal] = useState<string | string[]>(
    props.defaultValue ?? (props.type === 'multiple' ? [] : ''),
  );
  const value = props.value ?? internal;
  const {
    value: _value,
    defaultValue: _defaultValue,
    onValueChange,
    type,
    collapsible = true,
    ...rest
  } = props;
  const common = {
    ...rest,
    'data-slot': 'accordion',
    className: cn('w-full', className),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented || loop) return;
      const triggers = Array.from(
        event.currentTarget.querySelectorAll<HTMLButtonElement>(
          '[data-slot=accordion-trigger]:not(:disabled)',
        ),
      ).filter((item) => item.closest('[data-slot=accordion]') === event.currentTarget);
      const index = triggers.indexOf(event.target as HTMLButtonElement);
      const previous =
        event.key === 'ArrowUp' ||
        (rest.dir === 'rtl' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft');
      const next =
        event.key === 'ArrowDown' ||
        (rest.dir === 'rtl' ? event.key === 'ArrowLeft' : event.key === 'ArrowRight');
      if ((previous && index === 0) || (next && index === triggers.length - 1))
        event.preventDefault();
    },
  };
  return (
    <AccordionValue value={Array.isArray(value) ? value : [value]}>
      {type === 'multiple' ? (
        <AccordionPrimitive.Root
          {...common}
          type="multiple"
          value={Array.isArray(value) ? value : []}
          onValueChange={(next) => {
            setInternal(next);
            (onValueChange as ((v: string[]) => void) | undefined)?.(next);
          }}
        />
      ) : (
        <AccordionPrimitive.Root
          {...common}
          type="single"
          collapsible={collapsible}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => {
            setInternal(next);
            (onValueChange as ((v: string) => void) | undefined)?.(next);
          }}
        />
      )}
    </AccordionValue>
  );
}
export function AccordionItem({
  className,
  value,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  const open = useContext(AccordionValue).includes(value);
  return (
    <AccordionOpen value={open}>
      <AccordionPrimitive.Item
        data-slot="accordion-item"
        value={value}
        className={cn('relative', className)}
        {...props}
      />
    </AccordionOpen>
  );
}
export function AccordionHeader({
  className,
  level = 3,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Header> & { level?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const Heading = `h${level}` as 'h1';
  return (
    <AccordionPrimitive.Header asChild className={cn('flex', className)} {...props}>
      <Heading>{children}</Heading>
    </AccordionPrimitive.Header>
  );
}
export function AccordionTrigger({
  className,
  inset = true,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger> & { inset?: boolean }) {
  const density = useSize();
  return (
    <AccordionPrimitive.Trigger
      data-slot="accordion-trigger"
      className={cn(
        density === 'compact' ? 'min-h-7 py-1' : 'min-h-9 py-2',
        'w-full',
        'group type-caption flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-(--radius-small) px-2 text-left font-normal text-muted-foreground transition-[color,background-color,font-weight] duration-(--motion-fast) ease-(--ease-standard) hover:bg-hover hover:text-foreground data-[state=open]:font-semibold data-[state=open]:text-foreground focus-visible:outline focus-visible:-outline-offset-1 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
        !inset && 'px-0',
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1">{children}</span>
      <span className="first-line-icon">
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="size-4 shrink-0 text-muted-foreground transition-[color,transform,stroke-width] duration-(--motion-fast) ease-(--ease-standard) group-hover:text-foreground group-data-[state=open]:rotate-90 group-data-[state=open]:text-foreground group-data-[state=open]:[stroke-width:2] motion-reduce:transition-none"
          fill="none"
        >
          <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    </AccordionPrimitive.Trigger>
  );
}
export function AccordionContent({
  className,
  inset = true,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content> & { inset?: boolean }) {
  const open = useContext(AccordionOpen);
  const motion = useRef<HTMLDivElement>(null);
  const density = useSize();
  useAnimatedHeight(motion, open);
  return (
    <AccordionPrimitive.Content
      {...props}
      forceMount
      hidden={false}
      aria-hidden={!open || undefined}
      inert={!open}
      className={className}
    >
      <div ref={motion} data-accordion-content-motion className="will-change-[height]">
        <div
          className={cn(
            density === 'compact' ? 'pb-2.5' : 'pb-3',
            'type-caption px-2 pt-1 text-muted-foreground',
            !inset && 'px-0',
          )}
        >
          {children}
        </div>
      </div>
    </AccordionPrimitive.Content>
  );
}
export {
  Accordion as Root,
  AccordionItem as Item,
  AccordionHeader as Header,
  AccordionTrigger as Trigger,
  AccordionContent as Content,
};
