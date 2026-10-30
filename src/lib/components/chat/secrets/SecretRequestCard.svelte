<script lang="ts">
  /**
   * One agent secret request (PROTOCOL §5.56): a masked input whose value is
   * handed to the provide saga through the one-shot `secret-value-handoff`
   * (never a Redux action or state), or Dismiss (after a confirmation, like
   * the Q&A card). Hide collapses the whole stack. The value lives only in this
   * component's local input, kept for a retry if sending fails and cleared once
   * the request is answered — it never enters the store, drafts, the chat
   * composer or telemetry.
   */
  import Fa from 'svelte-fa';
  import { faEye, faEyeSlash, faKey } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
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
    /** Collapse the whole stack, like the Q&A card's Hide. */
    onHide?: () => void;
  }

  let { request, workspaceId, agentId, listedState, onHide }: Props = $props();

  const uid = $props.id();
  const secretRequests$ = selectSecretRequestsState();
  let value = $state('');
  let revealed = $state(false);
  let confirmingDismiss = $state(false);

  const answer = $derived($secretRequests$.answers[request.requestId]?.status);
  const busy = $derived(answer === 'sending');
  const shown = $derived<SecretRequestCardState>(
    answer === 'provided' || answer === 'declined' || answer === 'expired' ? answer : listedState,
  );
  const canAnswer = $derived(shown === 'pending' && !busy);

  // Drop the value once the request is answered or gone; a failed send keeps
  // it so the user can retry without pasting again.
  $effect(() => {
    if (shown === 'provided' || shown === 'declined' || shown === 'expired') {
      value = '';
      revealed = false;
    }
  });

  function answerWith(outcome: 'provided' | 'declined'): void {
    if (!canAnswer) return;
    if (outcome === 'provided') {
      if (value.length === 0) return;
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
  class="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
  data-testid="secret-request-card"
  data-request-id={request.requestId}
  data-state={shown}
>
  <div class="flex items-center gap-2 type-body-sm font-medium">
    <Fa icon={faKey} class="w-3 h-3 flex-shrink-0 text-muted-foreground" />
    <span>{m.chat_secretRequest_title_label({ name: request.name })}</span>
  </div>
  {#if request.reason}
    <p class="text-xs text-muted-foreground">{request.reason}</p>
  {/if}
  {#if shown === 'pending' || shown === 'checking'}
    <div class="flex flex-col gap-1">
      <Label for={`${uid}-value`} class="sr-only">
        {m.chat_secretRequest_value_label({ name: request.name })}
      </Label>
      <div class="flex items-center gap-2">
        <Input
          id={`${uid}-value`}
          type={revealed ? 'text' : 'password'}
          autocomplete="off"
          spellcheck={false}
          bind:value
          disabled={!canAnswer}
          placeholder={m.chat_secretRequest_value_placeholder()}
          onkeydown={handleKeydown}
          data-testid="secret-request-input"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={revealed
            ? m.chat_secretRequest_hide_ariaLabel()
            : m.chat_secretRequest_show_ariaLabel()}
          aria-pressed={revealed}
          disabled={!canAnswer}
          onclick={() => (revealed = !revealed)}
          data-testid="secret-request-reveal"
        >
          <Fa icon={revealed ? faEyeSlash : faEye} class="w-3 h-3" />
        </Button>
      </div>
      <p class="text-xs text-subtle">{m.chat_secretRequest_privacy_description()}</p>
    </div>
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        {#if onHide}
          <Button
            type="button"
            variant="ghost-light"
            size="compact"
            title={m.chat_secretRequest_hide_tooltip()}
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
          title={m.chat_secretRequest_dismiss_tooltip()}
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
        disabled={!canAnswer || value.length === 0}
        onclick={provide}
        data-testid="secret-request-provide"
      >
        {m.chat_secretRequest_provide_label()}
      </Button>
    </div>
  {:else if shown === 'provided'}
    <p class="text-xs text-muted-foreground" role="status">
      {m.chat_secretRequest_provided_description()}
    </p>
  {:else if shown === 'declined'}
    <p class="text-xs text-muted-foreground" role="status">
      {m.chat_secretRequest_declined_description()}
    </p>
  {:else}
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs text-muted-foreground" role="status">
        {m.chat_secretRequest_expired_description()}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onclick={() => appStore.dispatch(secretRequestHidden(request.requestId))}
        data-testid="secret-request-clear"
      >
        {m.chat_secretRequest_dismiss_label()}
      </Button>
    </div>
  {/if}
  {#if answer === 'failed' && shown === 'pending'}
    <p class="text-xs text-danger" role="alert">{m.chat_secretRequest_failed_error()}</p>
  {/if}
</div>

<SecretRequestDismissDialog
  open={confirmingDismiss}
  name={request.name}
  onConfirm={confirmDismiss}
  onCancel={() => (confirmingDismiss = false)}
/>
