<script lang="ts">
  /**
   * Destructive confirmation shown before the Q&A wizard's Dismiss is
   * performed. Dismissal is persistent (the host calls
   * `agent.dismissQuestions`, which survives reload), so the copy warns that
   * the questions are dismissed completely without answering and won't come
   * back. Cancel / Escape / backdrop close without side effects.
   *
   * Uses the canonical dialog primitive for focus trapping, focus restoration,
   * semantic overlay styling, Escape handling, and outside dismissal.
   */
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { m } from '$shared/paraglide/messages.js';
  interface Props {
    open?: boolean;
    static?: boolean;
    onConfirm?: () => void;
    onCancel?: () => void;
  }

  let { open = false, static: staticPosition = false, onConfirm, onCancel }: Props = $props();
</script>

<FormDialog
  {open}
  static={staticPosition}
  size="sm"
  title={m.chat_questionWizard_dismissDialog_title()}
  description={m.chat_questionWizard_dismissDialog_description()}
  closeLabel={m.chat_questionWizard_dismissDialog_close_ariaLabel()}
  cancelLabel={m.chat_questionWizard_dismissDialog_cancel_label()}
  submitLabel={m.chat_questionWizard_dismissDialog_confirm_label()}
  submitVariant="destructive"
  focusSubmit
  onSubmit={() => onConfirm?.()}
  onCancel={() => onCancel?.()}
/>
