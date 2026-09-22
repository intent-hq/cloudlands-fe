<script lang="ts">
  import type { ComponentProps, Snippet } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import DialogLayout from './DialogLayout.svelte';

  interface Props {
    open?: boolean;
    static?: boolean;
    title: string;
    description?: string;
    titleId?: string;
    descriptionId?: string;
    size?: ComponentProps<typeof Dialog.Content>['size'];
    role?: 'dialog' | 'alertdialog';
    busy?: boolean;
    dismissOnInteractOutside?: boolean;
    showCloseButton?: boolean;
    closeLabel?: string;
    initialFocus?: HTMLElement | null;
    contentRef?: HTMLElement | null;
    escapeKeydownBehavior?: 'close' | 'ignore';
    children?: Snippet;
    footer?: Snippet;
    onkeydown?: (event: KeyboardEvent) => void;
    onkeydowncapture?: (event: KeyboardEvent) => void;
    onClose?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title,
    description,
    titleId,
    descriptionId,
    size = 'default',
    role = 'dialog',
    busy = false,
    dismissOnInteractOutside = true,
    showCloseButton = true,
    closeLabel,
    initialFocus,
    contentRef = $bindable(null),
    escapeKeydownBehavior = 'close',
    children,
    footer,
    onkeydown,
    onkeydowncapture,
    onClose,
  }: Props = $props();
  let closed = $state(false);
  $effect(() => {
    if (open) closed = false;
  });

  function close() {
    if (busy || closed) return;
    closed = true;
    open = false;
    onClose?.();
  }
</script>

<Dialog.Root {open} {staticPosition} onOpenChange={(next) => !next && close()}>
  <Dialog.Content
    bind:ref={contentRef}
    {size}
    {role}
    {showCloseButton}
    {closeLabel}
    closeDisabled={busy}
    {escapeKeydownBehavior}
    class="app-no-drag flex min-h-0 flex-col overflow-hidden p-0"
    onOpenAutoFocus={(event) => {
      event.preventDefault();
      (initialFocus ?? contentRef)?.focus();
    }}
    onInteractOutside={(event) => {
      if (busy || !dismissOnInteractOutside) event.preventDefault();
    }}
    onEscapeKeydown={(event) => {
      if (busy) event.preventDefault();
    }}
    {onkeydown}
    {onkeydowncapture}
  >
    <DialogLayout {title} {description} {titleId} {descriptionId} {children} {footer} />
  </Dialog.Content>
</Dialog.Root>
