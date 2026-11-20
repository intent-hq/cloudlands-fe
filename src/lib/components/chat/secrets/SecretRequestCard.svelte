<script lang="ts">
  /**
   * One agent secret request (PROTOCOL §5.56): a masked input whose value is
   * handed to the provide saga through the one-shot `secret-value-handoff`
   * (never a Redux action or state), or Dismiss (after a confirmation, like
   * the Q&A card). Hide collapses the whole stack. The value lives only in
   * component-local state (bound to the stack, so Hide keeps it), kept for a
   * retry if sending fails and cleared once the request is answered — it never
   * enters the store, drafts, the chat composer or telemetry.
   */
  import Fa from 'svelte-fa';
  import { faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { InputMessage } from '$lib/components/ui/input-message';
  import { Label } from '$lib/components/ui/label';
  import { m } from '$shared/paraglide/messages.js';
  import type { SecretRequest } from '$shared/types/secret-request-resource';
  import {
    secretAnswerRequested,
    secretRequestHidden,
  } from '$store/renderer/slices/secret-requests/secret-requests-slice';
  import { selectSecretRequestsState } from '$store/renderer/slices/secret-requests/secret-requests-selectors';
  import { store as appStore } from '$store/renderer/store';
  import type { SecretRequestCardState } from './pending-secret-requests';
  import SecretRequestDismissDialog from './SecretRequestDismissDialog.svelte';
  import { stashSecretValue } from './secret-value-handoff';

  interface Props {
    request: SecretRequest;
    workspaceId: string;
    agentId: string;
    /** State from the daemon's `secret.list`; local answers override it. */
    listedState: SecretRequestCardState;
    /** The typed value; bindable so the stack can keep it while collapsed. */
    value?: string;
    /** Show the privacy note; a stack shows it on its first open card only. */
    showPrivacy?: boolean;
    /** Collapse the whole stack, like the Q&A card's Hide. */
    onHide?: () => void;
  }

  let {
    request,
    workspaceId,
    agentId,
    listedState,
    value = $bindable(),
    showPrivacy = true,
    onHide,
  }: Props = $props();

  const uid = $props.id();
  const secretRequests$ = selectSecretRequestsState();
  let revealed = $state(false);
  let confirmingDismiss = $state(false);

  const answer = $derived($secretRequests$.answers[request.requestId]?.status);
  const busy = $derived(answer === 'sending');
  const shown = $derived<SecretRequestCardState>(
    answer === 'provided' || answer === 'declined' || answer === 'expired' ? answer : listedState,
  );
  const open = $derived(shown === 'pending' || shown === 'checking');
  const canAnswer = $derived(shown === 'pending' && !busy);
  const failed = $derived(answer === 'failed' && shown === 'pending');
  const note = $derived(
    failed
      ? m.chat_secretRequest_failed_error()
      : showPrivacy
        ? m.chat_secretRequest_privacy_description()
        : null,
  );

  // Drop the value once the request is answered or gone; a failed send keeps
  // it so the user can retry without pasting again.
  $effect(() => {
    if (!open) {
      value = undefined;
      revealed = false;
    }
  });

  function answerWith(outcome: 'provided' | 'declined'): void {
    if (!canAnswer) return;
    if (outcome === 'provided') {
      if (!value) return;
      stashSecretValue(request.requestId, value);
    }
    appStore.dispatch(
      secretAnswerRequested({ workspaceId, agentId, requestId: request.requestId, outcome }),
    );
  }

  function provide(): void {
    answerWith('provided');
  }

  function confirmDismiss(): void {
    confirmingDismiss = false;
    answerWith('declined');
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      provide();
    }
  }
</script>

<div
  class="flex min-w-0 flex-col gap-2 rounded-(--radius-large) border border-border bg-card px-3 py-2.5 sm:px-4"
  role="group"
  aria-label={m.chat_secretRequest_title_label({ name: request.name })}
  data-testid="secret-request-card"
  data-request-id={request.requestId}
  data-state={shown}
>
  <div class="flex min-w-0 flex-col gap-0.5">
    <p class="type-code font-medium text-foreground wrap-anywhere">{request.name}</p>
    {#if open && request.reason}
      <p class="type-caption text-muted-foreground">{request.reason}</p>
    {/if}
  </div>
  {#if open}
    <div class="min-w-0">
      <Label for={`${uid}-value`} class="sr-only">
        {m.chat_secretRequest_value_label({ name: request.name })}
      </Label>
      <div class="relative min-w-0">
        <Input
          id={`${uid}-value`}
          type={revealed ? 'text' : 'password'}
          autocomplete="off"
          bind:value
          disabled={!canAnswer}
          placeholder={m.chat_secretRequest_value_placeholder()}
          aria-describedby={note ? `${uid}-message` : undefined}
          aria-invalid={failed || undefined}
          class="pr-9"
          onkeydown={handleKeydown}
          data-testid="secret-request-input"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
          aria-label={revealed
            ? m.chat_secretRequest_hide_ariaLabel()
            : m.chat_secretRequest_show_ariaLabel()}
          aria-pressed={revealed}
          disabled={!canAnswer}
          onclick={() => (revealed = !revealed)}
          data-testid="secret-request-reveal"
        >
          <Fa icon={revealed ? faEyeSlash : faEye} />
        </Button>
      </div>
      {#if note}
        <InputMessage id={`${uid}-message`} tone={failed ? 'error' : 'helper'}>{note}</InputMessage>
      {/if}
    </div>
    <div class="flex items-center justify-between gap-2">
      <div class="-ml-3 flex min-w-0 items-center gap-1">
        {#if onHide}
          <Button
            type="button"
            variant="ghost-light"
            size="compact"
            onclick={onHide}
            data-testid="secret-request-hide"
          >
            {m.chat_secretRequest_hide_label()}
          </Button>
        {/if}
        <Button
          type="button"
          variant="ghost"
          size="compact"
          class="text-danger"
          disabled={!canAnswer}
          onclick={() => (confirmingDismiss = true)}
          data-testid="secret-request-dismiss"
        >
          {m.chat_secretRequest_dismiss_label()}
        </Button>
      </div>
      <Button
        type="button"
        variant="primary"
        size="sm"
        loading={busy}
        disabled={!canAnswer || !value}
        onclick={provide}
        data-testid="secret-request-provide"
      >
        {m.chat_secretRequest_provide_label()}
      </Button>
    </div>
  {:else}
    <div class="flex items-center justify-between gap-2">
      <p class="type-caption text-muted-foreground" role="status">
        {shown === 'provided'
          ? m.chat_secretRequest_provided_description()
          : shown === 'declined'
            ? m.chat_secretRequest_declined_description()
            : m.chat_secretRequest_expired_description()}
      </p>
      {#if shown === 'expired'}
        <Button
          type="button"
          variant="ghost"
          size="compact"
          class="-my-1.5 -mr-3 shrink-0"
          onclick={() => appStore.dispatch(secretRequestHidden(request.requestId))}
          data-testid="secret-request-clear"
        >
          {m.chat_secretRequest_dismiss_label()}
        </Button>
      {/if}
    </div>
  {/if}
</div>

<SecretRequestDismissDialog
  open={confirmingDismiss}
  name={request.name}
  onConfirm={confirmDismiss}
  onCancel={() => (confirmingDismiss = false)}
/>
