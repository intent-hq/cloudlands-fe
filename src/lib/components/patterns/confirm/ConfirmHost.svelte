<script lang="ts">
  /* eslint-disable intent/no-component-async-data-fetch -- this host coordinates ephemeral UI promises; it does not load domain data */
  import { onMount } from 'svelte';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { m } from '$shared/paraglide/messages.js';
  import DestructiveConfirm from './DestructiveConfirm.svelte';
  import FormDialog from './FormDialog.svelte';
  import {
    settleConfirmRequest,
    subscribeConfirmRequests,
    type ConfirmRequest,
  } from './confirm-service';

  let request = $state<ConfirmRequest | null>(null);
  let value = $state('');
  let inputRef = $state<HTMLInputElement | null>(null);
  let busy = $state(false);

  onMount(() =>
    subscribeConfirmRequests((next) => {
      request = next;
      value = next?.kind === 'prompt' ? (next.options.field.initialValue ?? '') : '';
      busy = false;
    }),
  );

  function cancel() {
    if (!request || busy) return;
    settleConfirmRequest(request.id, request.kind === 'confirm' ? false : null);
  }

  async function accept() {
    if (!request || busy) return;
    const current = request;
    busy = true;
    try {
      if (current.kind === 'confirm') {
        await current.options.onConfirm?.();
        settleConfirmRequest(current.id, true);
      } else if (current.kind === 'prompt') {
        await current.options.onConfirm?.(value.trim());
        settleConfirmRequest(current.id, value.trim());
      } else {
        settleConfirmRequest(current.id, undefined);
      }
    } catch (error) {
      console.error('Confirm action failed:', error);
      busy = false;
    }
  }
</script>

{#if request?.kind === 'confirm'}
  <DestructiveConfirm
    open
    title={request.options.title}
    description={request.options.description}
    confirmLabel={request.options.confirmLabel ?? m.modals_bulkActionConfirm_confirm_label()}
    cancelLabel={request.options.cancelLabel ?? m.modals_bulkActionConfirm_cancel_label()}
    destructive={request.options.destructive ?? false}
    typedConfirmation={request.options.typedConfirmation}
    {busy}
    onConfirm={accept}
    onCancel={cancel}
  />
{:else if request?.kind === 'prompt'}
  <FormDialog
    open
    title={request.options.title}
    description={request.options.description}
    submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
    cancelLabel={request.options.cancelLabel ?? m.modals_input_cancel_label()}
    canSubmit={!request.options.field.required || value.trim().length > 0}
    {busy}
    initialFocus={inputRef}
    onSubmit={accept}
    onCancel={cancel}
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
    role="alertdialog"
    title={request.options.title}
    description={request.options.description}
    submitLabel={request.options.confirmLabel ?? m.modals_input_confirm_label()}
    showCancel={false}
    dismissOnInteractOutside={false}
    {busy}
    onSubmit={accept}
    onCancel={accept}
  />
{/if}
