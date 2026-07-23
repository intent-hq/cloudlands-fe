<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import Fa from 'svelte-fa';
  import { faXmark, faExclamationTriangle, faCircleInfo } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    open?: boolean;
    title: string;
    message: string;
    type?: 'info' | 'warning' | 'error';
    /** One button per label; selection reports the label's index. */
    buttons: string[];
    /** Index reported when the dialog is dismissed (Escape / backdrop / X). */
    cancelIndex?: number;
    onSelect?: (buttonIndex: number) => void;
  }

  let {
    open = $bindable(false),
    title,
    message,
    type = 'info',
    buttons,
    cancelIndex = 0,
    onSelect,
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

  function select(index: number) {
    open = false;
    onSelect?.(index);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      select(cancelIndex);
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="presentation"
    onkeydown={handleKeydown}
    onclick={() => select(cancelIndex)}
  >
    <div
      bind:this={dialogRef}
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="message-dialog-title"
      aria-describedby="message-dialog-description"
      tabindex="-1"
      onkeydown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          select(cancelIndex);
        }
      }}
    >
      <!-- Header -->
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <div class="flex items-center gap-3">
          {#if type === 'error'}
            <div class="text-red-600 dark:text-red-500">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
          {:else if type === 'warning'}
            <div class="text-amber-600 dark:text-amber-500">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
          {:else}
            <div class="text-subtle">
              <Fa icon={faCircleInfo} size="lg" />
            </div>
          {/if}
          <h2 id="message-dialog-title" class="text-lg font-semibold">{title}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onclick={() => select(cancelIndex)}
          aria-label="Close message dialog"
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <!-- Content -->
      <div class="p-6">
        <p id="message-dialog-description" class="text-sm text-subtle">{message}</p>
      </div>

      <!-- Footer -->
      <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
        {#each buttons as label, index (index)}
          <Button
            variant={index === cancelIndex
              ? 'ghost'
              : index === buttons.length - 1
                ? 'default'
                : 'outline'}
            onclick={() => select(index)}
          >
            {label}
          </Button>
        {/each}
      </div>
    </div>
  </div>
{/if}
