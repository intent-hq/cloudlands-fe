<script lang="ts">
  /**
   * Edit the conversation goal: a pre-filled editor whose Save calls
   * `agent.setGoal` (empty text removes the goal). A refusal keeps the dialog
   * open with the typed text and shows the reason under the field.
   */
  import { untrack } from 'svelte';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Textarea } from '$lib/components/ui/textarea';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { goalSetRequested } from '../conversation-goal-actions';
  import { goalErrorMessage } from '../utils/goal-error-message';

  interface Props {
    open?: boolean;
    workspaceId: string;
    agentId: string;
    /** The goal shown when the dialog opens. */
    initialGoal: string;
  }

  let { open = $bindable(false), workspaceId, agentId, initialGoal }: Props = $props();

  let value = $state('');
  let error = $state<string | undefined>();
  let saving = $state(false);
  let field = $state<HTMLTextAreaElement | null>(null);

  // Seed the field only when the dialog opens: a goal change pushed while it
  // is open (another client, or this Save's own reconcile) must not replace
  // the typed text or reset the in-flight Save.
  let wasOpen = false;
  $effect.pre(() => {
    const isOpen = open;
    if (isOpen && !wasOpen) {
      value = untrack(() => initialGoal);
      error = undefined;
      saving = false;
    }
    wasOpen = isOpen;
  });

  async function save() {
    if (saving) return;
    saving = true;
    error = undefined;
    try {
      const outcome = await appStore.dispatch(
        goalSetRequested(workspaceId, agentId, value.trim() ? value : null),
      );
      if (outcome.ok) open = false;
      else error = goalErrorMessage(outcome.error);
    } catch {
      error = m.chat_goal_failed_error();
    } finally {
      saving = false;
    }
  }
</script>

<FormDialog
  bind:open
  title={m.chat_goalEditor_dialog_title()}
  submitLabel={m.chat_goalEditor_save_label()}
  cancelLabel={m.chat_goalEditor_cancel_label()}
  submitBusy={saving}
  initialFocus={field}
  enterKey="ignore"
  modEnter="submit"
  onSubmit={save}
>
  <Textarea
    bind:ref={field}
    bind:value
    aria-label={m.chat_goalEditor_field_label()}
    placeholder={m.chat_goalEditor_field_label()}
    message={m.chat_goalEditor_field_description()}
    {error}
    autoResize
    minHeight={96}
    maxHeight={320}
    data-testid="goal-editor-field"
  />
</FormDialog>
