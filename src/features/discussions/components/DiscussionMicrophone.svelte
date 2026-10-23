<script lang="ts">
  import { untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import {
    selectDiscussionTarget,
    selectDiscussionCanSend,
    selectDiscussionCanCreate,
  } from '$store/renderer/slices/workspace-discussion/workspace-discussion-selectors';
  import Fa from 'svelte-fa';
  import { faMicrophone } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { notify } from '$lib/components/patterns/notify';
  import { store } from '$store/renderer/store';
  import { selectEffectiveVoiceEngine } from '$store/renderer/slices/voice-settings/voice-settings-selectors';
  import { showVoiceSetupToast } from '$features/hardware-console/voice/voice-setup-toast';
  import { createDiscussionMicrophone } from '../discussion-microphone';
  import { m } from '$shared/paraglide/messages.js';
  let {
    workspaceId,
    conversationId,
    active = true,
    disabled = false,
    onTranscript,
  }: {
    workspaceId: string;
    conversationId: string;
    active?: boolean;
    disabled?: boolean;
    onTranscript: (text: string) => void;
  } = $props();
  const workspaceId$ = writable('');
  const conversationId$ = writable('');
  $effect(() => {
    workspaceId$.set(workspaceId);
    conversationId$.set(conversationId);
  });
  const target$ = selectDiscussionTarget(workspaceId$, conversationId$);
  const identity = $derived($target$ ? JSON.stringify($target$) : null);
  let state = $state<'idle' | 'recording' | 'transcribing'>('idle');
  let controller: ReturnType<typeof createDiscussionMicrophone> | undefined;
  $effect(() => {
    const capturedIdentity = identity;
    const capturedWorkspace = workspaceId;
    const capturedConversation = conversationId;
    const insert = untrack(() => onTranscript);
    const instance = createDiscussionMicrophone({
      workspaceId: capturedWorkspace,
      isActive: () => {
        const current = selectDiscussionTarget.select(
          store.state,
          capturedWorkspace,
          capturedConversation,
        );
        const canCompose =
          capturedConversation === 'new'
            ? selectDiscussionCanCreate.select(store.state, capturedWorkspace)
            : selectDiscussionCanSend.select(store.state, capturedWorkspace, capturedConversation);
        return (
          !!capturedIdentity &&
          active &&
          !disabled &&
          !document.hidden &&
          canCompose &&
          workspaceId === capturedWorkspace &&
          conversationId === capturedConversation &&
          JSON.stringify(current) === capturedIdentity
        );
      },
      context: {
        dispatch: (action) => store.dispatch(action as { type: string }),
        showHint: (message) => notify.info(message),
      },
      onTranscript: insert,
      onState: (next) => (state = next),
    });
    controller = instance;
    return () => instance.cancel();
  });
  $effect(() => {
    if (!active || disabled) controller?.cancel();
  });
  const label = $derived(
    state === 'recording'
      ? m.chat_richInput_micStop_label()
      : state === 'transcribing'
        ? m.chat_richInput_micCancelTranscribing_label()
        : m.chat_richInput_micStart_label(),
  );
  function toggle() {
    if (state === 'idle' && selectEffectiveVoiceEngine.select(store.state) === 'unavailable') {
      showVoiceSetupToast();
      return;
    }
    controller?.toggle();
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || state === 'idle') return;
    event.preventDefault();
    event.stopPropagation();
    controller?.cancel();
  }
</script>

<svelte:window onkeydowncapture={escape} onblur={() => controller?.cancel()} />
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) controller?.cancel();
  }}
/>
<Button
  variant="ghost"
  size="icon-sm"
  disabled={disabled || !active || !identity}
  onclick={toggle}
  aria-label={label}
  tooltip={label}
  aria-pressed={state === 'recording'}
  class={state === 'recording' ? 'text-danger' : ''}
>
  {#if state === 'transcribing'}<IntentMarkLoader size={14} />{:else}<Fa
      icon={faMicrophone}
      size="sm"
    />{/if}
</Button>
