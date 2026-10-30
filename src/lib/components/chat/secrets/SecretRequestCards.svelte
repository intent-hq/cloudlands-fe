<script lang="ts">
  /**
   * Composer-slot stack of open secret-request cards (PROTOCOL §5.56).
   * Requests the agent's names-only `secret.list` when the agent, its set of
   * transcript requests or the daemon connection changes, to tell pending
   * cards from expired ones and to find pending requests whose card is outside
   * the loaded page. Hide collapses the stack to one chip, like the Q&A
   * card; a new request expands it again. Values never pass through here.
   */
  import { untrack } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { m } from '$shared/paraglide/messages.js';
  import {
    secretAnswerRequested,
    secretListRequested,
    secretRequestsCollapsed,
    secretRequestsExpanded,
  } from '$store/renderer/slices/secret-requests/secret-requests-slice';
  import { selectSecretRequestsState } from '$store/renderer/slices/secret-requests/secret-requests-selectors';
  import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { store as appStore } from '$store/renderer/store';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import SecretRequestDismissDialog from './SecretRequestDismissDialog.svelte';
  import {
    isSecretStackCollapsed,
    visibleSecretRequests,
    type SecretRequestTranscript,
  } from './pending-secret-requests';

  interface Props {
    transcript: SecretRequestTranscript;
    workspaceId: string;
    agentId: string;
  }

  let { transcript, workspaceId, agentId }: Props = $props();

  const secretRequests$ = selectSecretRequestsState();
  const connectionGeneration$ = selectDaemonConnectionGeneration();
  const visible = $derived(
    visibleSecretRequests(
      transcript,
      agentId,
      $secretRequests$.listings[agentId],
      $secretRequests$.hidden,
    ),
  );

  const visibleIds = $derived(visible.map(({ request }) => request.requestId));
  const collapsed = $derived(
    isSecretStackCollapsed(visibleIds, $secretRequests$.collapsed[agentId]),
  );
  // The chip offers Dismiss only for a single pending request, like the Q&A
  // chip; with several, the user expands the stack to choose.
  const chipRequest = $derived.by(() => {
    if (visible.length !== 1) return null;
    const [only] = visible;
    if (only.state !== 'pending') return null;
    const status = $secretRequests$.answers[only.request.requestId]?.status;
    return status === undefined || status === 'failed' ? only.request : null;
  });
  let confirmingChipDismiss = $state(false);

  function hide(): void {
    appStore.dispatch(secretRequestsCollapsed(agentId, visibleIds));
  }

  function expand(): void {
    appStore.dispatch(secretRequestsExpanded(agentId));
  }

  function dismissChipRequest(): void {
    confirmingChipDismiss = false;
    if (!chipRequest) return;
    appStore.dispatch(
      secretAnswerRequested({
        workspaceId,
        agentId,
        requestId: chipRequest.requestId,
        outcome: 'declined',
      }),
    );
  }

  // A string, so transcript updates that keep the same requests (streaming
  // deltas, new messages) do not refetch.
  const requestKey = $derived(transcript.open.map((request) => request.requestId).join(','));

  // A reconnect (or daemon restart) refreshes too, so a failed read recovers
  // and requests lost on restart show as expired.
  $effect(() => {
    void $connectionGeneration$;
    const key = requestKey;
    const workspace = workspaceId;
    const agent = agentId;
    untrack(() => {
      appStore.dispatch(secretListRequested(workspace, agent, key ? key.split(',') : []));
    });
  });
</script>

{#if visible.length > 0}
  <div class="flex w-full flex-col gap-2 px-4 pb-2" data-testid="secret-request-cards">
    {#if collapsed}
      <div
        class="flex w-full min-w-0 items-center rounded-(--radius-large) border border-border bg-card"
        data-testid="secret-request-chip"
      >
        <Button
          variant="plain"
          wrapContent={false}
          class="h-auto min-w-0 flex-1 justify-start gap-2 px-3 py-2.5 text-left sm:px-4"
          aria-expanded={false}
          onclick={expand}
          data-testid="secret-request-expand"
        >
          <span class="min-w-0 flex-1 truncate type-caption font-medium text-foreground">
            {visible.length === 1
              ? m.chat_secretRequest_title_label({ name: visible[0].request.name })
              : m.chat_secretRequest_collapsedMany_label({ count: visible.length })}
          </span>
          <span class="min-w-0 max-w-[40%] truncate type-caption text-muted-foreground">
            {m.chat_secretRequest_clickToExpand_label()}
          </span>
        </Button>
        {#if chipRequest}
          <div class="shrink-0 pr-1 sm:pr-2">
            <Button
              variant="ghost"
              size="xs"
              class="text-danger"
              title={m.chat_secretRequest_dismiss_tooltip()}
              onclick={() => (confirmingChipDismiss = true)}
              data-testid="secret-request-chip-dismiss"
            >
              {m.chat_secretRequest_dismiss_label()}
            </Button>
          </div>
        {/if}
      </div>
    {:else}
      {#each visible as { request, state } (request.requestId)}
        <SecretRequestCard {request} {workspaceId} {agentId} listedState={state} onHide={hide} />
      {/each}
    {/if}
  </div>
{/if}

{#if chipRequest}
  <SecretRequestDismissDialog
    open={confirmingChipDismiss}
    name={chipRequest.name}
    onConfirm={dismissChipRequest}
    onCancel={() => (confirmingChipDismiss = false)}
  />
{/if}
