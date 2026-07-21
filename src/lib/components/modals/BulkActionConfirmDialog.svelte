<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import type { ButtonVariant } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import {
  faXmark,
  faExclamationTriangle,
} from '@fortawesome/free-solid-svg-icons';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    confirmText?: string;
    variant?: ButtonVariant;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    title = 'Confirm Action',
    description = '',
    confirmText = 'Confirm',
    variant = 'default',
    onConfirm,
    onCancel,
  }: Props = $props();

  let dialogRef: HTMLDivElement | null = $state(null);

  // Focus dialog when it opens so Escape key works. Deferred a microtask so
  // it lands after any Portal relocation in the same flush (moving a focused
  // node in the DOM drops focus back to <body>).
  $effect(() => {
    if (open && dialogRef) {
      const el = dialogRef;
      queueMicrotask(() => el.focus());
    }
  });

  function close() {
    open = false;
    onCancel?.();
  }

  async function handleConfirm() {
    try {
      await onConfirm?.();
    } catch (error) {
      console.error('Confirm action failed:', error);
    }
    open = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="presentation"
    onkeydown={handleKeydown}
    onclick={close}
  >
    <div
      bind:this={dialogRef}
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-dialog-title"
      aria-describedby="bulk-dialog-description"
      tabindex="-1"
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
        } else {
          e.stopPropagation();
        }
      }}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class={variant === 'destructive' ? 'text-red-600 dark:text-red-500' : 'text-amber-600 dark:text-amber-500'}>
            <Fa icon={faExclamationTriangle} size="lg" />
          </div>
          <h2 id="bulk-dialog-title" class="text-lg font-semibold">{title}</h2>
        </div>
        <Button variant="ghost" size="icon" onclick={close} aria-label="Close">
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <p id="bulk-dialog-description" class="text-sm text-subtle">{description}</p>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        <Button variant="ghost" onclick={close}>Cancel</Button>
        <Button {variant} onclick={handleConfirm}>{confirmText}</Button>
      </div>
    </div>
  </div>
{/if}

