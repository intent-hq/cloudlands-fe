<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { FormDialog } from '$lib/components/patterns/confirm';

  interface Props {
    open?: boolean;
    static?: boolean;
    title: string;
    message: string;
    type?: 'info' | 'warning' | 'error';
    /** One button per label; selection reports the label's index. */
    buttons: string[];
    /** Index reported when the dialog is dismissed (Escape / X). */
    cancelIndex?: number;
    onSelect?: (buttonIndex: number) => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    title,
    message,
    buttons,
    cancelIndex = 0,
    onSelect,
  }: Props = $props();

  function select(index: number) {
    open = false;
    onSelect?.(index);
  }
</script>

<FormDialog
  bind:open
  static={staticPosition}
  role="alertdialog"
  {title}
  dismissOnInteractOutside={false}
  focusContent
  onSubmit={() => select(buttons.length - 1)}
  onCancel={() => select(cancelIndex)}
>
  <Dialog.Description class="sr-only">{message}</Dialog.Description>
  <p class="type-body">{message}</p>

  {#snippet footer()}
    {#each buttons as label, index (index)}
      <Button
        variant={index === cancelIndex
          ? 'ghost'
          : index === buttons.length - 1
            ? 'primary'
            : 'outline'}
        onclick={() => select(index)}
      >
        {label}
      </Button>
    {/each}
  {/snippet}
</FormDialog>
