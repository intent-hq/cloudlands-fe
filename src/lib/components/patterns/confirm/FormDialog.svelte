<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte';
  import type { ButtonVariant } from '$lib/components/ui/button';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Form, FormActions } from '$lib/components/patterns/form';
  import { m } from '$shared/paraglide/messages.js';
  import { cn } from '$lib/utils';
  import DialogLayout from './DialogLayout.svelte';

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
    role?: 'dialog' | 'alertdialog';
    dismissOnInteractOutside?: boolean;
    showCancel?: boolean;
    showCloseButton?: boolean;
    closeLabel?: string;
    class?: string;
    size?: ComponentProps<typeof Dialog.Content>['size'];
    initialFocus?: HTMLElement | null;
    focusContent?: boolean;
    focusSubmit?: boolean;
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
    footer: customFooter,
    submitLabel = m.modals_bulkActionConfirm_confirm_label(),
    cancelLabel = m.modals_bulkActionConfirm_cancel_label(),
    submitVariant = 'primary',
    canSubmit = true,
    busy = false,
    role = 'dialog',
    dismissOnInteractOutside = true,
    showCancel = true,
    showCloseButton = true,
    closeLabel = m.ui_dialog_close_ariaLabel(),
    class: className,
    size = 'default',
    initialFocus,
    focusContent = false,
    focusSubmit = false,
    escapeKeydownBehavior = 'close',
    enterKey = 'submit',
    modEnter = 'submit',
    onfocusin,
    onSubmit,
    onCancel,
  }: Props = $props();

  let internalBusy = $state(false);
  let submissionError = $state('');
  let cancellationHandled = $state(false);
  let contentRef = $state<HTMLElement | null>(null);
  let submitRef = $state<HTMLButtonElement | null>(null);
  const isBusy = $derived(busy || internalBusy);

  $effect(() => {
    if (open) {
      cancellationHandled = false;
      submissionError = '';
    }
  });

  function cancel() {
    if (isBusy || cancellationHandled) return;
    cancellationHandled = true;
    open = false;
    onCancel?.();
  }

  async function submit() {
    if (isBusy || !canSubmit) return;
    internalBusy = true;
    submissionError = '';
    try {
      await onSubmit();
    } catch {
      submissionError = m.ui_dialog_submitFailed_error();
    } finally {
      internalBusy = false;
    }
  }

  function handleOpenAutoFocus(event: Event) {
    const target = initialFocus ?? (focusSubmit ? submitRef : focusContent ? contentRef : null);
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
    {size}
    class={cn('flex min-h-0 flex-col overflow-hidden p-0', className)}
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
    onInteractOutside={(event) => (isBusy || !dismissOnInteractOutside) && event.preventDefault()}
    onEscapeKeydown={(event) => isBusy && event.preventDefault()}
  >
    <Form
      onSubmit={submit}
      busy={isBusy}
      {enterKey}
      {modEnter}
      class="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <DialogLayout
        {title}
        {description}
        {titleId}
        {descriptionId}
        {children}
        error={submissionError}
      >
        {#snippet footer()}
          {#if customFooter}
            {@render customFooter()}
          {:else}
            <FormActions>
              {#snippet secondary()}
                {#if showCancel}
                  <Button variant="ghost-light" disabled={isBusy} onclick={cancel}
                    >{cancelLabel}</Button
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
                  loading={isBusy}
                  disabled={!canSubmit || isBusy}
                >
                  {submitLabel}
                </Button>
              {/snippet}
            </FormActions>
          {/if}
        {/snippet}
      </DialogLayout>
    </Form>
  </Dialog.Content>
</Dialog.Root>
