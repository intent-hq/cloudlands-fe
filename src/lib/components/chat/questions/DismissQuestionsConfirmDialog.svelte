<script lang="ts">
  /**
   * Destructive confirmation shown before the Q&A wizard's Dismiss is
   * performed. Dismissal is persistent (the host calls
   * `agent.dismissQuestions`, which survives reload), so the copy warns that
   * the questions are dismissed completely without answering and won't come
   * back. Cancel / Escape / backdrop close without side effects.
   *
   * Portaled to the document body (same pattern as ModelSwitchConfirmDialog)
   * so the fixed-position overlay escapes the composer's overflow/stacking
   * contexts.
   */
  import { Button } from '$lib/components/ui/button';
  import Portal from '$lib/components/ui/Portal.svelte';
  import Fa from 'svelte-fa';
  import { faXmark, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    open?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, onConfirm, onCancel }: Props = $props();

  let dialogRef: HTMLDivElement | null = $state(null);

  // Focus dialog when it opens so Escape key works (same deferred-microtask
  // pattern as ModelSwitchConfirmDialog — Portal relocation drops focus).
  $effect(() => {
    if (open && dialogRef) {
      const el = dialogRef;
      queueMicrotask(() => el.focus());
    }
  });
</script>

{#if open}
  <Portal target="body" zIndex={100}>
    <div
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      role="presentation"
      onclick={() => onCancel?.()}
    >
      <div
        bind:this={dialogRef}
        class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md overflow-hidden flex flex-col"
        onclick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dismiss-questions-dialog-title"
        aria-describedby="dismiss-questions-dialog-description"
        tabindex="-1"
        onkeydown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            onCancel?.();
          }
        }}
      >
        <div class="px-6 py-4 border-b border-border flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="text-destructive-foreground">
              <Fa icon={faExclamationTriangle} size="lg" />
            </div>
            <h2 id="dismiss-questions-dialog-title" class="text-lg font-semibold">
              {m.chat_questionWizard_dismissDialog_title()}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onclick={() => onCancel?.()}
            aria-label={m.chat_questionWizard_dismissDialog_close_ariaLabel()}
          >
            <Fa icon={faXmark} />
          </Button>
        </div>

        <div id="dismiss-questions-dialog-description" class="p-6 text-sm text-subtle">
          <p>{m.chat_questionWizard_dismissDialog_description()}</p>
        </div>

        <div class="px-6 py-4 border-t border-border flex justify-end gap-2">
          <Button variant="ghost" onclick={() => onCancel?.()}>
            {m.chat_questionWizard_dismissDialog_cancel_label()}
          </Button>
          <Button variant="destructive" onclick={() => onConfirm?.()}>
            {m.chat_questionWizard_dismissDialog_confirm_label()}
          </Button>
        </div>
      </div>
    </div>
  </Portal>
{/if}
