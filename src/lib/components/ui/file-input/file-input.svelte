<script lang="ts">
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { m } from '$shared/paraglide/messages.js';

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
    error?: string;
    files?: FileList;
    onFilesChange?: (files: FileList | undefined) => void;
    class?: string;
  } = $props();

  let inputRef: HTMLInputElement | null = $state(null);
  const errorId = $derived(error ? `${id}-error` : undefined);
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
  data-invalid={invalid || undefined}
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
    aria-invalid={invalid || undefined}
    aria-describedby={errorId}
    class="sr-only"
    tabindex="-1"
    onchange={handleChange}
  />
  <div
    data-slot="file-input-surface"
    class={cn(
      'flex min-h-(--control-height-medium) min-w-0 items-center gap-2 rounded-(--radius-medium) border p-0.5 transition-[border-color,background-color,box-shadow] duration-(--motion-fast) focus-within:border-ring focus-within:ring-0 motion-reduce:transition-none',
      variant === 'default'
        ? 'border-border bg-card shadow-(--elevation-raised) hover:border-input'
        : 'border-transparent bg-muted/40 shadow-none hover:border-transparent',
      (disabled || busy) && 'bg-muted/40 opacity-60 hover:border-border',
      invalid && 'border-danger ring-1 ring-danger/25',
    )}
  >
    <Button
      type="button"
      variant={variant === 'flat' ? 'ghost' : 'outline'}
      size="sm"
      class={cn('shrink-0', 'aria-invalid:border-danger aria-invalid:ring-danger/25')}
      {disabled}
      loading={busy}
      aria-controls={id}
      aria-invalid={invalid || undefined}
      aria-describedby={errorId}
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
  {#if error}
    <p id={errorId} class="type-body mt-1.5 text-danger" role="alert">
      {error}
    </p>
  {/if}
</div>
