<script lang="ts">
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { m } from '$shared/paraglide/messages.js';
  import DestructiveConfirm from './DestructiveConfirm.svelte';
  import FormDialog from './FormDialog.svelte';
  import type { ConfirmOptions, PromptOptions, AlertOptions } from './types';

  let {
    request,
    value = $bindable(''),
    busy = false,
    static: staticPosition = false,
    onAccept,
    onCancel,
  }: {
    request:
      | { kind: 'confirm'; options: ConfirmOptions }
      | { kind: 'prompt'; options: PromptOptions }
      | { kind: 'alert'; options: AlertOptions };
    value?: string;
    busy?: boolean;
    static?: boolean;
    onAccept: (value: string) => void;
    onCancel: () => void;
  } = $props();
  let inputRef = $state<HTMLInputElement | null>(null);
</script>

{#if request?.kind === 'confirm'}
  <DestructiveConfirm
    open
    static={staticPosition}
    title={request.options.title}
    description={request.options.description}
    confirmLabel={request.options.confirmLabel ?? m.modals_bulkActionConfirm_confirm_label()}
    cancelLabel={request.options.cancelLabel ?? m.modals_bulkActionConfirm_cancel_label()}
    destructive={request.options.destructive ?? false}
    {busy}
    onConfirm={() => onAccept(value)}
    {onCancel}
  />
{:else if request?.kind === 'prompt'}
  <FormDialog
    open
    static={staticPosition}
    title={request.options.title}
    description={request.options.description}
    submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
    cancelLabel={request.options.cancelLabel ?? m.modals_input_cancel_label()}
    canSubmit={!request.options.field.required || value.trim().length > 0}
    {busy}
    initialFocus={inputRef}
    onSubmit={() => onAccept(value)}
    {onCancel}
  >
    <div class="grid gap-2">
      {#if request.options.field.label}
        <Label for="confirm-prompt-field">{request.options.field.label}</Label>
      {/if}
      <Input
        id="confirm-prompt-field"
        bind:ref={inputRef}
        bind:value
        type={request.options.field.type ?? 'text'}
        placeholder={request.options.field.placeholder}
      />
    </div>
  </FormDialog>
{:else if request?.kind === 'alert'}
  <FormDialog
    open
    static={staticPosition}
    role="alertdialog"
    title={request.options.title}
    description={request.options.description}
    submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
    showCancel={false}
    dismissOnInteractOutside={false}
    {busy}
    onSubmit={() => onAccept(value)}
    onCancel={() => onAccept(value)}
  />
{/if}
