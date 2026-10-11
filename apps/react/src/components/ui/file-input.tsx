import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Button } from '@/components/ui/button';
import { InputMessage } from '@/components/ui/input-message';
import { useSize, type UiSize } from '@/components/ui/size-context';
import { textEntryGroupClasses, textEntryHeight } from '@/components/ui/text-entry';
import { cn } from '@/lib/utils';
import { truncatedTitle } from '$lib/actions/observe-overflow';
import { m } from '$shared/paraglide/messages.js';

export interface FileInputHandle {
  openPicker: () => void;
}
export interface FileInputProps {
  id: string;
  label?: string;
  emptyText?: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  name?: string;
  disabled?: boolean;
  busy?: boolean;
  invalid?: boolean;
  variant?: 'default' | 'flat';
  state?: 'rest' | 'hover' | 'focus';
  size?: UiSize;
  message?: string;
  error?: string;
  files?: FileList;
  onFilesChange?: (files: FileList | undefined) => void;
  hiddenHost?: boolean;
  className?: string;
  ref?: Ref<FileInputHandle>;
}

export function FileInput({
  id,
  label = m.ui_fileInput_chooseFile_label(),
  emptyText = m.ui_fileInput_noFileSelected_label(),
  accept,
  multiple = false,
  required = false,
  name,
  disabled = false,
  busy = false,
  invalid = false,
  variant = 'default',
  state,
  size,
  message,
  error,
  files,
  onFilesChange,
  hiddenHost = false,
  className,
  ref,
}: FileInputProps) {
  const contextSize = useSize();
  const input = useRef<HTMLInputElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const [selection, setSelection] = useState({ source: files, files });
  let selectedFiles = selection.files;
  if (selection.source !== files) {
    selectedFiles = files;
    setSelection({ source: files, files });
  }
  const errorId = error ? `${id}-error` : undefined;
  const messageId = !error && message ? `${id}-message` : undefined;
  const describedBy = errorId ?? messageId;
  const resolvedSize = size ?? contextSize;
  const isInvalid = invalid || Boolean(error);
  const selectedText = selectedFiles?.length
    ? Array.from(selectedFiles, (file) => file.name).join(', ')
    : emptyText;
  useLayoutEffect(() => {
    if (!input.current) return;
    if (files && input.current.files !== files) input.current.files = files;
    else if (!files) input.current.value = '';
  }, [files]);
  useLayoutEffect(() => {
    const form = input.current?.form;
    const reset = (event: Event) => {
      queueMicrotask(() => {
        if (event.defaultPrevented) return;
        setSelection({ source: files, files: undefined });
        onFilesChange?.(undefined);
      });
    };
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [onFilesChange, files]);
  useLayoutEffect(() => {
    if (!text.current) return;
    const observer = truncatedTitle(text.current, selectedText);
    return () => observer?.destroy?.();
  }, [selectedText, hiddenHost]);
  const openPicker = () => input.current?.click();
  useImperativeHandle(ref, () => ({ openPicker }));
  return (
    <div
      data-slot="file-input"
      className={cn('min-w-0', className)}
      aria-busy={busy || undefined}
      aria-disabled={disabled || busy || undefined}
      data-invalid={isInvalid || undefined}
      data-variant={variant}
      data-host-mode={hiddenHost ? 'hidden' : 'surface'}
      hidden={hiddenHost}
    >
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        multiple={multiple}
        required={required}
        name={name}
        disabled={disabled || busy}
        aria-hidden="true"
        aria-invalid={isInvalid || undefined}
        aria-describedby={describedBy}
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const next = event.currentTarget.files ?? undefined;
          setSelection({ source: files, files: next });
          onFilesChange?.(next);
        }}
      />
      {!hiddenHost && (
        <div
          data-slot="file-input-surface"
          data-state={state}
          data-size={resolvedSize}
          className={cn(
            'flex min-w-0 items-center gap-2 rounded-(--radius-medium) p-1',
            textEntryGroupClasses,
            textEntryHeight(resolvedSize),
            variant === 'default'
              ? 'border-0 bg-hover hover:bg-card'
              : 'border-0 bg-transparent shadow-none',
            (disabled || busy) && 'pointer-events-none opacity-60',
          )}
        >
          <Button
            type="button"
            variant={variant === 'flat' ? 'ghost' : 'outline'}
            size={resolvedSize === 'compact' ? 'xs' : 'default'}
            className="h-full shrink-0 aria-invalid:ring-0"
            disabled={disabled}
            loading={busy}
            aria-controls={id}
            aria-invalid={isInvalid || undefined}
            aria-describedby={describedBy}
            onClick={openPicker}
          >
            {label}
          </Button>
          <span
            ref={text}
            className="type-caption min-w-0 flex-1 truncate text-muted-foreground"
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- Preserve the source inline status and truncation observer.
            role="status"
            aria-live="polite"
          >
            {selectedText}
          </span>
        </div>
      )}
      {!hiddenHost && (error || message) && (
        <InputMessage id={errorId ?? messageId} tone={error ? 'error' : 'helper'}>
          {error ?? message}
        </InputMessage>
      )}
    </div>
  );
}
