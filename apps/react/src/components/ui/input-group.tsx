// Source: src/lib/components/ui/input-group/input-group.svelte.
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input, type InputProps } from './input';
import { Textarea } from './textarea';
import { Button } from './button';
import { InputMessage } from './input-message';
import { SizeProvider, useSize, type UiSize } from './size-context';
import { textEntryGroupClasses, textEntryHeight } from './text-entry';
const InputGroupState = createContext<{ disabled: boolean; invalid: boolean; messageId?: string }>({
  disabled: false,
  invalid: false,
});
export type InputGroupProps = ComponentProps<'div'> & {
  size?: UiSize;
  leading?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  invalid?: boolean;
  message?: string;
  error?: string;
  messageId?: string;
};
export function InputGroup({
  ref,
  size,
  leading,
  trailing,
  children,
  disabled = false,
  invalid = false,
  message,
  error,
  messageId,
  className,
  ...props
}: InputGroupProps) {
  const uid = useId();
  const contextSize = useSize();
  const resolvedSize = size ?? contextSize;
  const visibleMessage = error ?? message;
  const resolvedMessageId = messageId ?? `${uid}-message`;
  return (
    <SizeProvider size={resolvedSize}>
      <InputGroupState
        value={{
          disabled,
          invalid: invalid || Boolean(error),
          messageId: visibleMessage ? resolvedMessageId : undefined,
        }}
      >
        <div data-slot="input-group-field" className={cn('min-w-0', className)}>
          <div
            ref={ref}
            data-slot="input-group"
            data-disabled={disabled || undefined}
            data-invalid={invalid || Boolean(error) || undefined}
            data-size={resolvedSize}
            aria-describedby={visibleMessage ? resolvedMessageId : undefined}
            className={cn(
              'group/input-group flex min-w-0 items-stretch overflow-hidden rounded-(--radius-medium) border',
              textEntryGroupClasses,
              textEntryHeight(resolvedSize),
              '[&_[data-slot=input]]:h-full [&_[data-slot=input]]:rounded-none [&_[data-slot=input]]:border-0 [&_[data-slot=input]]:bg-transparent [&_[data-slot=input]]:shadow-none [&_[data-slot=input]]:hover:bg-transparent [&_[data-slot=input]]:focus-visible:bg-transparent [&_[data-slot=input]]:focus-visible:shadow-none',
              '[&_[data-slot=button]]:h-full [&_[data-slot=button]]:rounded-none [&_[data-slot=button]]:border-0 [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:shadow-none [&_[data-slot=button]]:focus-visible:-outline-offset-1 [&_[data-slot=button]]:hover:text-foreground [&_[data-slot=button-surface]]:hidden',
            )}
            {...props}
          >
            {leading && <InputGroupAddon side="leading">{leading}</InputGroupAddon>}
            <span
              data-slot="input-group-control"
              className="flex h-full min-w-0 flex-1 items-center"
            >
              {children}
            </span>
            {trailing && <InputGroupAddon side="trailing">{trailing}</InputGroupAddon>}
          </div>
          {visibleMessage && (
            <InputMessage id={resolvedMessageId} tone={error ? 'error' : 'helper'}>
              {visibleMessage}
            </InputMessage>
          )}
        </div>
      </InputGroupState>
    </SizeProvider>
  );
}
export function InputGroupAddon({
  side = 'leading',
  className,
  ...props
}: ComponentProps<'span'> & { side?: 'leading' | 'trailing' }) {
  return (
    <span
      data-slot="input-group-addon"
      data-side={side}
      className={cn(
        'flex h-full shrink-0 items-center border-border px-2 leading-none text-muted-foreground transition-colors duration-(--spring-fast) has-[[data-slot=button]]:h-[inherit] has-[[data-slot=button]]:p-0 group-hover/input-group:text-foreground group-focus-within/input-group:text-foreground motion-reduce:transition-none',
        side === 'leading' ? 'border-r' : 'border-l',
        className,
      )}
      {...props}
    />
  );
}
export function InputGroupInput(props: InputProps) {
  const group = useContext(InputGroupState);
  return (
    <Input
      {...props}
      disabled={props.disabled ?? group.disabled}
      aria-invalid={props['aria-invalid'] ?? (group.invalid || undefined)}
      aria-describedby={
        [props['aria-describedby'], group.messageId].filter(Boolean).join(' ') || undefined
      }
    />
  );
}
export function InputGroupTextarea(props: ComponentProps<typeof Textarea>) {
  const group = useContext(InputGroupState);
  return (
    <Textarea
      {...props}
      disabled={props.disabled ?? group.disabled}
      aria-invalid={props['aria-invalid'] ?? (group.invalid || undefined)}
      aria-describedby={
        [props['aria-describedby'], group.messageId].filter(Boolean).join(' ') || undefined
      }
    />
  );
}
export function InputGroupButton(props: ComponentProps<typeof Button>) {
  const group = useContext(InputGroupState);
  return <Button {...props} disabled={props.disabled ?? group.disabled} />;
}
export { InputGroup as Root };
