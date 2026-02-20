<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    open?: boolean;
    title?: string;
    description?: string;
    placeholder?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: (value: string) => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    title = 'Enter value',
    description = '',
    placeholder = '',
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    onConfirm,
    onCancel,
  }: Props = $props();

  let inputValue = $state('');
  let inputRef: HTMLInputElement | null = $state(null);

  function close() {
    open = false;
    inputValue = '';
    onCancel?.();
  }

  function confirm() {
    if (!inputValue.trim()) return;
    onConfirm?.(inputValue.trim());
    open = false;
    inputValue = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      confirm();
    }
  }

  // Focus input when dialog opens
  $effect(() => {
    if (open) {
      // Use requestAnimationFrame to ensure the input is mounted
      requestAnimationFrame(() => {
        inputRef?.focus();
      });
    }
  });
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="button"
    tabindex="0"
    onkeydown={handleKeydown}
    onclick={close}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold">{title}</h2>
          {#if description}
            <p class="text-sm text-muted-foreground mt-0.5">{description}</p>
          {/if}
        </div>
        <Button variant="ghost" size="icon" onclick={close}>
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <input
          bind:this={inputRef}
          bind:value={inputValue}
          type="text"
          {placeholder}
          onkeydown={handleKeydown}
          class="w-full px-3 py-2 bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
          autocorrect="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        <Button variant="ghost" onclick={close}>{cancelLabel}</Button>
        <Button variant="default" onclick={confirm} disabled={!inputValue.trim()}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  </div>
{/if}
