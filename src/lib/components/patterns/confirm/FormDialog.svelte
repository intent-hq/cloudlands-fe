<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { ButtonVariant } from '$lib/components/ui/button';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Form, FormActions } from '$lib/components/patterns/form';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    static?: boolean;
    title: string;
    description?: string;
    titleId?: string;
    descriptionId?: string;
    children?: Snippet;
    footer?: Snippet;
    submitLabel?: string;
    cancelLabel?: string;
    submitVariant?: ButtonVariant;
    canSubmit?: boolean;
    busy?: boolean;
    /** Disable and show progress on submit while keeping cancellation available. */
    submitBusy?: boolean;
    role?: 'dialog' | 'alertdialog';
    dismissOnInteractOutside?: boolean;
    showCancel?: boolean;
    showCloseButton?: boolean;
    closeLabel?: string;
    class?: string;
    initialFocus?: HTMLElement | null;
    focusContent?: boolean;
    focusSubmit?: boolean;
    focusCancel?: boolean;
    escapeKeydownBehavior?: 'close' | 'ignore';
    enterKey?: 'submit' | 'ignore';
    modEnter?: 'submit' | 'ignore';
    onfocusin?: (event: FocusEvent) => void;
    onSubmit: () => void | Promise<void>;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title,
    description,
    titleId,
    descriptionId,
    children,
    footer,
    submitLabel = m.modals_bulkActionConfirm_confirm_label(),
    cancelLabel = m.modals_bulkActionConfirm_cancel_label(),
    submitVariant = 'default',
    canSubmit = true,
    busy = false,
    submitBusy = false,
    role = 'dialog',
    dismissOnInteractOutside = true,
    showCancel = true,
    showCloseButton = true,
    closeLabel = m.ui_dialog_close_ariaLabel(),
    class: className,
    initialFocus,
    focusContent = false,
    focusSubmit = false,
    focusCancel = false,
    escapeKeydownBehavior = 'close',
    enterKey = 'submit',
    modEnter = 'submit',
    onfocusin,
    onSubmit,
    onCancel,
  }: Props = $props();

  let internalBusy = $state(false);
  let cancellationHandled = $state(false);
  let contentRef = $state<HTMLElement | null>(null);
  let cancelRef = $state<HTMLButtonElement | null>(null);
  let submitRef = $state<HTMLButtonElement | null>(null);
  const isBusy = $derived(busy || internalBusy);

  $effect(() => {
    if (open) cancellationHandled = false;
  });

  function cancel() {
    if (isBusy || cancellationHandled) return;
    cancellationHandled = true;
    onCancel?.();
    open = false;
  }

  async function submit() {
    if (isBusy || submitBusy || !canSubmit) return;
    internalBusy = true;
    try {
      await onSubmit();
    } finally {
      internalBusy = false;
    }
  }

  function handleOpenAutoFocus(event: Event) {
    const target =
      initialFocus ??
      (focusCancel ? cancelRef : focusSubmit ? submitRef : focusContent ? contentRef : null);
    if (!target) return;
    target.focus();
    // A disabled or hidden submit target cannot take focus; let Dialog.Content
    // choose an editable field or the dialog rather than leaving focus outside.
    if (target.ownerDocument.activeElement === target) event.preventDefault();
  }
</script>

<Dialog.Root {open} {staticPosition} onOpenChange={(nextOpen) => !nextOpen && cancel()}>
  <Dialog.Content
    bind:ref={contentRef}
    {role}
    class={className}
    closeDisabled={isBusy}
    {showCloseButton}
    {closeLabel}
    {escapeKeydownBehavior}
    onOpenAutoFocus={handleOpenAutoFocus}
    {onfocusin}
    onkeydown={(event) => {
      if (event.key === 'Escape' && escapeKeydownBehavior === 'close') {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    }}
    onInteractOutside={(event) => !dismissOnInteractOutside && event.preventDefault()}
  >
    <Form onSubmit={submit} busy={isBusy} {enterKey} {modEnter}>
      <Dialog.Header class="mb-0">
        <Dialog.Title id={titleId}>{title}</Dialog.Title>
        {#if description}<Dialog.Description id={descriptionId}>{description}</Dialog.Description
          >{/if}
      </Dialog.Header>

      {@render children?.()}

      <Dialog.Footer>
        {#if footer}
          {@render footer()}
        {:else}
          <FormActions>
            {#snippet secondary()}
              {#if showCancel}
                <Button
                  bind:ref={cancelRef}
                  variant="ghost-light"
                  disabled={isBusy}
                  onclick={cancel}>{cancelLabel}</Button
                >
              {/if}
            {/snippet}
            {#snippet primary()}
              <Button
                bind:ref={submitRef}
                type="submit"
                variant={submitVariant}
                class={focusSubmit
                  ? 'focus-visible:outline focus-visible:-outline-offset-1'
                  : undefined}
                loading={isBusy || submitBusy}
                disabled={!canSubmit || isBusy || submitBusy}
              >
                {submitLabel}
              </Button>
            {/snippet}
          </FormActions>
        {/if}
      </Dialog.Footer>
    </Form>
  </Dialog.Content>
</Dialog.Root>
