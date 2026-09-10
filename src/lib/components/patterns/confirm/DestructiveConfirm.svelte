<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import FormDialog from './FormDialog.svelte';

  interface Props {
    open?: boolean;
    static?: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel?: string;
    typedConfirmation?: string;
    typedLabel?: string;
    details?: Snippet;
    busy?: boolean;
    destructive?: boolean;
    class?: string;
    closeLabel?: string;
    onConfirm: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title,
    description,
    confirmLabel,
    cancelLabel,
    typedConfirmation,
    typedLabel,
    details,
    busy = false,
    destructive = true,
    class: className,
    closeLabel,
    onConfirm,
    onCancel,
  }: Props = $props();

  let typedValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);
  const canSubmit = $derived(!typedConfirmation || typedValue === typedConfirmation);

  $effect(() => {
    if (open) typedValue = '';
  });
</script>

<FormDialog
  bind:open
  static={staticPosition}
  {title}
  {description}
  submitLabel={confirmLabel}
  {cancelLabel}
  submitVariant={destructive ? 'destructive' : 'default'}
  {canSubmit}
  {busy}
  initialFocus={typedConfirmation ? inputRef : null}
  focusSubmit={!typedConfirmation}
  class={className}
  {closeLabel}
  onSubmit={onConfirm}
  {onCancel}
>
  {#if details}{@render details()}{/if}
  {#if typedConfirmation}
    <div class="grid gap-2">
      {#if typedLabel}<Label for="typed-confirmation">{typedLabel}</Label>{/if}
      <Input
        id="typed-confirmation"
        bind:ref={inputRef}
        bind:value={typedValue}
        autocomplete="off"
      />
    </div>
  {/if}
</FormDialog>
