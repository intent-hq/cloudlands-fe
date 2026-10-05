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
  import { FormDialog } from '$lib/components/patterns/confirm';
  import * as Accordion from '$lib/components/ui/accordion';
  import { Textarea } from '$lib/components/ui/textarea';
  import { m } from '$shared/paraglide/messages.js';
  import { buildReplaceAgentHandoffMessage } from '$shared/utils/replace-agent-handoff';

  interface Props {
    open?: boolean;
    static?: boolean;
    /** Exact current name of the agent being replaced. */
    agentName: string;
    /** Specialist id from the session metadata, when known. */
    specialist?: string | null;
    /** Receives the current (possibly edited) instruction text on Send. */
    onSend?: (text: string) => void;
    onCancel?: () => void;
  }

  let {
    open = $bindable(false),
    static: staticPosition = false,
    agentName,
    specialist = null,
    onSend,
    onCancel,
  }: Props = $props();

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

<FormDialog
  bind:open
  static={staticPosition}
  title={m.modals_replaceAgent_title()}
  description={m.modals_replaceAgent_description({ name: agentName })}
  closeLabel={m.modals_replaceAgent_close_ariaLabel()}
  submitLabel={m.modals_replaceAgent_send_label()}
  cancelLabel={m.modals_replaceAgent_cancel_label()}
  canSubmit={canSend}
  enterKey="ignore"
  focusContent
  onSubmit={handleSend}
  onCancel={close}
>
  <Accordion.Root type="single">
    <Accordion.Item value="instructions">
      <Accordion.Trigger inset={false}
        >{m.modals_replaceAgent_instruction_ariaLabel()}</Accordion.Trigger
      >
      <Accordion.Content inset={false}>
        <p class="type-caption mb-3 text-muted-foreground">
          {m.modals_replaceAgent_editHint_description()}
        </p>
        <Textarea
          bind:value={text}
          aria-label={m.modals_replaceAgent_instruction_ariaLabel()}
          class="max-h-72 min-h-48 w-full type-body"
        />
      </Accordion.Content>
    </Accordion.Item>
  </Accordion.Root>
</FormDialog>
