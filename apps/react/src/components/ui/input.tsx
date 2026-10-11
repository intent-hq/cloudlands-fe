// Based on shadcn/ui input; validation and density mirror input.svelte.
import { useId, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { InputMessage } from '@/components/ui/input-message';
import { useSize, type UiSize } from '@/components/ui/size-context';
import {
  textEntryCaretFocusClasses,
  textEntryControlClasses,
  textEntryFocusResetClasses,
  textEntryHeight,
} from './text-entry';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & {
  size?: UiSize | number;
  noFocusStyle?: boolean;
  message?: string;
  error?: string;
  messageId?: string;
};
export function Input({
  className,
  type,
  size,
  noFocusStyle = false,
  message,
  error,
  messageId,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  ...props
}: InputProps) {
  const uid = useId();
  const density = useSize();
  const resolvedSize = typeof size === 'string' ? size : density;
  const visibleMessage = error ?? message;
  const resolvedMessageId = messageId ?? `${uid}-message`;
  return (
    <>
      <input
        data-slot="input"
        data-size={resolvedSize}
        type={type}
        size={typeof size === 'number' ? size : undefined}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={
          [ariaDescribedBy, visibleMessage ? resolvedMessageId : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        className={cn(
          'type-caption text-foreground selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground flex w-full min-w-0 rounded-(--radius-medium) border px-3',
          type === 'file'
            ? 'file:mr-3 file:border-0 file:bg-transparent file:font-medium file:text-foreground focus-visible:-outline-offset-2'
            : cn('py-1', textEntryCaretFocusClasses),
          textEntryControlClasses,
          textEntryHeight(resolvedSize),
          noFocusStyle && textEntryFocusResetClasses,
          className,
        )}
        {...props}
      />
      {visibleMessage && (
        <InputMessage id={resolvedMessageId} tone={error ? 'error' : 'helper'}>
          {visibleMessage}
        </InputMessage>
      )}
    </>
  );
}
