// Based on shadcn/ui textarea; auto-resize and messages mirror textarea.svelte.
import { useCallback, useId, useLayoutEffect, useRef, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { InputMessage } from '@/components/ui/input-message';
import { useSize, type UiSize } from '@/components/ui/size-context';
import {
  textEntryCaretFocusClasses,
  textEntryControlClasses,
  textEntryFocusResetClasses,
} from './text-entry';

export type TextareaProps = ComponentProps<'textarea'> & {
  doesExpandToFit?: boolean;
  autoResize?: boolean;
  minHeight?: number;
  maxHeight?: number;
  noFocusStyle?: boolean;
  size?: UiSize;
  message?: string;
  error?: string;
  messageId?: string;
};
export function Textarea({
  ref,
  className,
  value,
  doesExpandToFit = false,
  autoResize = false,
  minHeight = 80,
  maxHeight = 400,
  noFocusStyle = false,
  size,
  message,
  error,
  messageId,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  style,
  onInput,
  ...props
}: TextareaProps) {
  const uid = useId();
  const density = useSize();
  const element = useRef<HTMLTextAreaElement>(null);
  const resolvedSize = size ?? density;
  const shouldAutoResize = autoResize || doesExpandToFit;
  const visibleMessage = error ?? message;
  const resolvedMessageId = messageId ?? `${uid}-message`;
  const resize = useCallback(() => {
    const node = element.current;
    if (!shouldAutoResize || !node) return;
    node.style.height = 'auto';
    const scrollHeight = node.scrollHeight;
    node.style.height = `${Math.min(Math.max(scrollHeight, minHeight), maxHeight)}px`;
    node.style.overflowY = scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [shouldAutoResize, minHeight, maxHeight]);
  useLayoutEffect(resize, [resize, value]);
  return (
    <>
      <textarea
        ref={(node) => {
          element.current = node;
          if (typeof ref === 'function') return ref(node);
          if (ref) ref.current = node;
        }}
        value={value}
        data-slot="textarea"
        data-size={resolvedSize}
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={
          [ariaDescribedBy, visibleMessage ? resolvedMessageId : undefined]
            .filter(Boolean)
            .join(' ') || undefined
        }
        className={cn(
          'type-caption text-foreground placeholder:text-muted-foreground flex w-full rounded-(--radius-medium) border px-3',
          textEntryControlClasses,
          textEntryCaretFocusClasses,
          resolvedSize === 'compact' ? 'py-1.5' : 'py-2',
          shouldAutoResize ? 'resize-none overflow-hidden' : 'min-h-20',
          noFocusStyle && textEntryFocusResetClasses,
          className,
        )}
        style={{ ...(shouldAutoResize ? { minHeight, maxHeight } : {}), ...style }}
        onInput={(event) => {
          resize();
          onInput?.(event);
        }}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
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
