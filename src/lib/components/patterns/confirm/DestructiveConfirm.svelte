<script lang="ts">
  import type { Snippet } from 'svelte';
  import FormDialog from './FormDialog.svelte';

  interface Props {
    open?: boolean;
    static?: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    cancelLabel?: string;
    details?: Snippet;
    busy?: boolean;
    /** Disable and show progress on submit while keeping cancellation available. */
    submitBusy?: boolean;
    canSubmit?: boolean;
    focusSubmit?: boolean;
    focusCancel?: boolean;
    enterKey?: 'submit' | 'ignore';
    modEnter?: 'submit' | 'ignore';
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
    details,
    busy = false,
    submitBusy = false,
    canSubmit = true,
    focusSubmit = true,
    focusCancel = false,
    enterKey = 'submit',
    modEnter = 'submit',
    destructive = true,
    class: className,
    closeLabel,
    onConfirm,
    onCancel,
  }: Props = $props();
</script>

<FormDialog
  bind:open
  static={staticPosition}
  {title}
  {description}
  submitLabel={confirmLabel}
  {cancelLabel}
  submitVariant={destructive ? 'destructive' : 'default'}
  {busy}
  {submitBusy}
  {canSubmit}
  {focusSubmit}
  {focusCancel}
  {enterKey}
  {modEnter}
  class={className}
  {closeLabel}
  onSubmit={onConfirm}
  {onCancel}
>
  {#if details}{@render details()}{/if}
</FormDialog>
