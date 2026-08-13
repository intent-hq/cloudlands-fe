<script lang="ts">
  /**
   * @deprecated Use `$lib/components/ui/dialog`.
   * Removal gate: migrate SetupScriptModal and keep canonical Dialog behavior tests green.
   */
  import type { Snippet } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    title?: string;
    contentClass?: string;
    onClose?: () => void;
    children?: Snippet;
  }

  let {
    open = $bindable(false),
    title = '',
    contentClass = 'px-12 py-8',
    onClose,
    children,
  }: Props = $props();
  let escapeKeydownBehavior = $state<'close' | 'ignore'>('close');

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) onClose?.();
  }

  function handleFocusIn(event: FocusEvent) {
    const target = event.target;
    escapeKeydownBehavior =
      target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        ? 'ignore'
        : 'close';
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content
    showCloseButton={false}
    {escapeKeydownBehavior}
    onfocusin={handleFocusIn}
    class="max-w-6xl border-0 bg-transparent p-0 shadow-none"
  >
    <div class="flex items-center justify-between px-1 pb-4">
      <Dialog.Title class="text-lg font-medium tracking-[-0.02em]">{title}</Dialog.Title>
      <Dialog.Close
        aria-label={m.modals_modal_close_ariaLabel()}
        class="rounded-sm p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" class="size-4" fill="none">
          <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </Dialog.Close>
    </div>
    <div
      class="bg-sidebar border border-border shadow-xs {contentClass} overflow-hidden flex flex-col min-h-0"
    >
      {@render children?.()}
    </div>
  </Dialog.Content>
</Dialog.Root>
