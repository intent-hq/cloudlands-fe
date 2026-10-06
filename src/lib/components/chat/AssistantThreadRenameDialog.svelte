<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { FormField } from '$lib/components/patterns/form';
  import { Input } from '$lib/components/ui/input';
  import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import type { ChiefThreadSummary } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';
  import {
    agentMutationUiConsumed,
    agentMutationUiReleased,
    agentMutationUiRequested,
  } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-slice';
  import { selectAgentMutationUi } from '$store/renderer/slices/agent-mutation-ui/agent-mutation-ui-selectors';
  import { selectHidesAgentLifecycleActions } from '$store/renderer/slices/workspace/workspace-selectors';

  let {
    thread,
    returnFocus,
    onClose,
  }: {
    thread: ChiefThreadSummary;
    returnFocus: HTMLButtonElement;
    onClose: () => void;
  } = $props();

  const consumerId = crypto.randomUUID();
  const outcome$ = selectAgentMutationUi(CHIEF_WORKSPACE_ID, consumerId);
  const hidesActions$ = selectHidesAgentLifecycleActions(CHIEF_WORKSPACE_ID);
  let open = $state(true);
  let name = $state(untrack(() => thread.title));
  let inputRef = $state<HTMLInputElement | null>(null);
  const busy = $derived($outcome$?.status === 'pending');
  const error = $derived(
    $outcome$?.status === 'failed' ? m.layout_chiefCard_renameThread_error() : undefined,
  );

  $effect(() => {
    if (open && inputRef) inputRef.select();
  });
  $effect(() => {
    if ($outcome$?.status === 'succeeded' || $outcome$?.status === 'cancelled') {
      open = false;
      appStore.dispatch(
        agentMutationUiConsumed(CHIEF_WORKSPACE_ID, consumerId, $outcome$.requestId),
      );
    }
    if ($hidesActions$) open = false;
  });
  onDestroy(() => appStore.dispatch(agentMutationUiReleased(CHIEF_WORKSPACE_ID, consumerId)));

  function rename() {
    const nextName = name.trim();
    const current = selectAgentMutationUi.select(appStore.state, CHIEF_WORKSPACE_ID, consumerId);
    if (current?.status === 'pending' || $hidesActions$ || !nextName || nextName === thread.title)
      return;
    appStore.dispatch(
      agentMutationUiRequested(
        CHIEF_WORKSPACE_ID,
        consumerId,
        crypto.randomUUID(),
        thread.agentId,
        {
          kind: 'rename',
          name: nextName,
        },
      ),
    );
  }
</script>

<FormDialog
  bind:open
  title={m.layout_chiefCard_renameThread_title()}
  submitLabel={m.workspace_notes_rename_label()}
  canSubmit={Boolean(name.trim()) && name.trim() !== thread.title}
  {busy}
  size="sm"
  initialFocus={inputRef}
  onSubmit={rename}
  onCloseAutoFocus={(event) => {
    event.preventDefault();
    if (returnFocus.isConnected) returnFocus.focus();
    onClose();
  }}
>
  <FormField label={m.layout_chiefCard_threadName_label()} {error} required>
    {#snippet control(props)}
      <Input {...props} bind:ref={inputRef} bind:value={name} />
    {/snippet}
  </FormField>
</FormDialog>
