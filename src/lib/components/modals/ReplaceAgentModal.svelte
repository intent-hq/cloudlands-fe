<script lang="ts">
  /**
   * Replace Agent modal (peer-agent hand-off).
   *
   * Shows a plain-language explanation of the hand-off protocol plus an
   * EDITABLE textarea pre-filled with the built hand-off instruction
   * (`buildReplaceAgentHandoffMessage` — agent-facing, English-only by
   * design). Send hands the CURRENT textarea text to `onSend` — the caller
   * dispatches it through the normal chat send path so it lands in the
   * transcript as a regular user message. Cancel / Escape / backdrop close
   * without side effects.
   *
   * Uses the canonical dialog primitive for focus trapping, focus
   * restoration, Escape handling, and outside dismissal.
   */
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Textarea } from '$lib/components/ui/textarea';
  import { m } from '$shared/paraglide/messages.js';
  import { buildReplaceAgentHandoffMessage } from '$shared/utils/replace-agent-handoff';

  interface Props {
    open?: boolean;
    /** Exact current name of the agent being replaced. */
    agentName: string;
    /** Specialist id from the session metadata, when known. */
    specialist?: string | null;
    /** Receives the current (possibly edited) instruction text on Send. */
    onSend?: (text: string) => void;
    onCancel?: () => void;
  }

  let { open = $bindable(false), agentName, specialist = null, onSend, onCancel }: Props = $props();

  // Pre-filled once at mount — callers mount the modal per open, so each open
  // starts from a freshly built instruction.
  // svelte-ignore state_referenced_locally -- intentional snapshot of the props at mount
  let text = $state(buildReplaceAgentHandoffMessage({ agentName, specialist }));

  const canSend = $derived(text.trim().length > 0);

  function close() {
    open = false;
    onCancel?.();
  }

  function handleSend() {
    if (!canSend) return;
    const message = text;
    open = false;
    onSend?.(message);
  }
</script>

<Dialog.Root {open} onOpenChange={(nextOpen) => !nextOpen && close()}>
  <Dialog.Content
    class="max-w-xl gap-0 overflow-hidden p-0"
    closeLabel={m.modals_replaceAgent_close_ariaLabel()}
  >
    <div class="space-y-4 p-5 pr-12">
      <Dialog.Header class="gap-2 pr-0">
        <Dialog.Title>{m.modals_replaceAgent_title()}</Dialog.Title>
        <Dialog.Description class="leading-5">
          {m.modals_replaceAgent_description({ name: agentName })}
        </Dialog.Description>
      </Dialog.Header>

      <Textarea
        bind:value={text}
        aria-label={m.modals_replaceAgent_instruction_ariaLabel()}
        class="max-h-72 min-h-48 w-full text-xs leading-5"
      />

      <p class="text-sm leading-5 text-subtle">
        {m.modals_replaceAgent_editHint_description()}
      </p>
    </div>

    <Dialog.Footer class="mt-0 flex-row items-center justify-end border-0 px-5 pb-5 pt-0">
      <Button variant="ghost-light" onclick={close}>
        {m.modals_replaceAgent_cancel_label()}
      </Button>
      <Button variant="default" onclick={handleSend} disabled={!canSend}>
        {m.modals_replaceAgent_send_label()}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
