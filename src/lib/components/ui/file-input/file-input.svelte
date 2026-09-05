<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { useSize, type UiSize } from '$lib/components/ui/size-context';
  import { textEntryGroupClasses, textEntryHeight } from '../text-entry';

  const contextSize = useSize();

  let {
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
    state: previewState,
    size,
    message,
    error,
    files = $bindable(),
    onFilesChange,
    class: className,
  }: {
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
    class?: string;
  } = $props();

  let inputRef: HTMLInputElement | null = $state(null);
  const errorId = $derived(error ? `${id}-error` : undefined);
  const messageId = $derived(!error && message ? `${id}-message` : undefined);
  const describedBy = $derived(errorId ?? messageId);
  const resolvedSize = $derived(size ?? contextSize);
  const isInvalid = $derived(invalid || Boolean(error));
  const selectedText = $derived(
    files?.length ? Array.from(files, (file) => file.name).join(', ') : emptyText,
  );

  function openPicker() {
    inputRef?.click();
  }

  function handleChange(event: Event) {
    files = (event.currentTarget as HTMLInputElement).files ?? undefined;
    onFilesChange?.(files);
  }

  function handleFormReset(event: Event) {
    queueMicrotask(() => {
      if (event.defaultPrevented) return;
      files = undefined;
      onFilesChange?.(undefined);
    });
  }

  onMount(() => {
    const form = inputRef?.form;
    form?.addEventListener('reset', handleFormReset);
    return () => form?.removeEventListener('reset', handleFormReset);
  });
</script>

<div
  data-slot="file-input"
  class={cn('min-w-0', className)}
  aria-busy={busy || undefined}
  aria-disabled={disabled || busy || undefined}
  data-invalid={isInvalid || undefined}
  data-variant={variant}
>
  <input
    bind:this={inputRef}
    bind:files
    {id}
    type="file"
    {accept}
    {multiple}
    {required}
    {name}
    disabled={disabled || busy}
    aria-hidden="true"
    aria-invalid={isInvalid || undefined}
    aria-describedby={describedBy}
    class="sr-only"
    tabindex="-1"
    onchange={handleChange}
  />
  <div
    data-slot="file-input-surface"
    data-state={previewState}
    data-size={resolvedSize}
    class={cn(
      'flex min-w-0 items-center gap-2 rounded-(--radius-medium) p-1',
      textEntryGroupClasses,
      textEntryHeight(resolvedSize),
      variant === 'default'
        ? 'border-0 bg-hover hover:bg-card'
        : 'border-0 bg-transparent shadow-none',
      (disabled || busy) && 'pointer-events-none opacity-60',
      isInvalid && 'ring-1 ring-danger/25',
    )}
  >
    <Button
      type="button"
      variant={variant === 'flat' ? 'ghost' : 'outline'}
      size={resolvedSize === 'compact' ? 'xs' : 'default'}
      class={cn('h-full shrink-0', 'aria-invalid:border-danger aria-invalid:ring-danger/25')}
      {disabled}
      loading={busy}
      aria-controls={id}
      aria-invalid={isInvalid || undefined}
      aria-describedby={describedBy}
      onclick={openPicker}>{label}</Button
    >
    <span
      class="type-body min-w-0 flex-1 truncate text-muted-foreground"
      role="status"
      aria-live="polite"
      title={selectedText}
    >
      {selectedText}
    </span>
  </div>
  {#if error || message}
    <InputMessage id={errorId ?? messageId} tone={error ? 'error' : 'helper'}>
      {error ?? message}
    </InputMessage>
  {/if}
</div>
