<script lang="ts">
  /**
   * Composer-slot stack of open secret-request cards (PROTOCOL §5.56).
   * Requests the agent's names-only `secret.list` when the agent, its set of
   * transcript requests or the daemon connection changes, to tell pending
   * cards from expired ones and to find pending requests whose card is outside
   * the loaded page. Hide collapses the stack to one chip, like the Q&A
   * card; a new request expands it again. Typed values stay in this
   * component's local state while collapsed, never in the store.
   */
  import { untrack } from 'svelte';
  import { slide, springIn } from '$lib/motion';
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
  import CollapsedCardChip from '../CollapsedCardChip.svelte';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import {
    awaitingSecretRequests,
    showSecretStackChip,
    visibleSecretRequests,
    type SecretRequestTranscript,
  } from './pending-secret-requests';

  interface Props {
    transcript: SecretRequestTranscript;
    workspaceId: string;
    agentId: string;
    /** The daemon's answered requests (`secretRequestResolutions`). */
    resolutions?: Readonly<Record<string, 'provided' | 'declined'>>;
  }

  let { transcript, workspaceId, agentId, resolutions }: Props = $props();

  const secretRequests$ = selectSecretRequestsState();
  const connectionGeneration$ = selectDaemonConnectionGeneration();
  const answers = $derived($secretRequests$.answers);
  const visible = $derived(
    visibleSecretRequests(
      transcript,
      agentId,
      $secretRequests$.listings[agentId],
      $secretRequests$.hidden,
      answers,
      resolutions,
    ),
  );
  const collapsedKeys = $derived($secretRequests$.collapsed[agentId]);
  const awaiting = $derived(awaitingSecretRequests(visible, answers));
  // The first waiting card carries the stack's one Hide.
  const leadRequestId = $derived(awaiting[0]?.request.requestId);
  const collapsed = $derived(showSecretStackChip(visible, answers, collapsedKeys));
  // The chip offers Skip only for a single waiting request; with several,
  // the user expands the stack to choose.
  const chipRequest = $derived.by(() => {
    if (!collapsed || awaiting.length !== 1) return null;
    const [only] = awaiting;
    if (only.state !== 'pending') return null;
    return answers[only.request.requestId]?.status === 'sending' ? null : only.request;
  });
  // Typed values by request id, kept here so Hide does not lose them.
  let values = $state<Record<string, string>>({});
  let stackElement = $state<HTMLDivElement>();
  let chipExpandButton = $state<HTMLElement | null>(null);
  let focusAfter = $state<'chip' | 'cards' | null>(null);

  $effect(() => {
    const live = new Set(visible.map(({ request }) => request.requestId));
    untrack(() => {
      for (const requestId of Object.keys(values))
        if (!live.has(requestId)) delete values[requestId];
    });
  });

  // Nothing left to show: forget the hidden snapshot so it cannot re-collapse
  // a later stack.
  $effect(() => {
    if (visible.length === 0 && collapsedKeys)
      untrack(() => appStore.dispatch(secretRequestsExpanded(agentId)));
  });

  // Keep keyboard focus with the user's action: Hide focuses the chip,
  // expanding focuses the first card's input.
  $effect(() => {
    const target = focusAfter;
    const root = stackElement;
    void collapsed;
    if (!target || !root) return;
    const element =
      target === 'chip'
        ? chipExpandButton
        : (root.querySelector<HTMLElement>(
            '[data-testid="secret-request-input"]:not([disabled])',
          ) ?? root.querySelector<HTMLElement>('[data-testid="secret-request-card"] button'));
    if (element) {
      element.focus();
      focusAfter = null;
    }
  });

  function hide(): void {
    focusAfter = 'chip';
    appStore.dispatch(
      secretRequestsCollapsed(
        agentId,
        visible.map(({ cardKey }) => cardKey),
      ),
    );
  }

  function expand(): void {
    focusAfter = 'cards';
    appStore.dispatch(secretRequestsExpanded(agentId));
  }

  function skipChipRequest(): void {
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
  <div
    bind:this={stackElement}
    class="w-full pb-2"
    data-testid="secret-request-cards"
    in:springIn={{ tier: 'moderate', y: 8, scale: 1 }}
    out:slide={{ tier: 'moderate' }}
  >
    {#if collapsed}
      <div in:springIn={{ tier: 'moderate', y: 4, scale: 1 }}>
        <CollapsedCardChip
          bind:expandButton={chipExpandButton}
          data-testid="secret-request-chip"
          heading={awaiting.length === 1
            ? m.chat_secretRequest_collapsed_one({ name: awaiting[0].request.name })
            : m.chat_secretRequest_collapsed_many({ count: awaiting.length })}
          hint={m.chat_secretRequest_clickToExpand_label()}
          onExpand={expand}
          expandTestId="secret-request-expand"
          dismiss={chipRequest
            ? {
                label: m.chat_secretRequest_skip_label(),
                tone: 'neutral',
                onDismiss: skipChipRequest,
                testId: 'secret-request-chip-dismiss',
              }
            : undefined}
        />
      </div>
    {:else}
      <div class="mx-auto max-w-160" in:springIn={{ tier: 'moderate', y: 8, scale: 1 }}>
        {#each visible as { request, state } (request.requestId)}
          <div
            class="not-first:pt-2"
            in:springIn={{ tier: 'moderate', y: 8, scale: 1 }}
            out:slide={{ tier: 'moderate' }}
          >
            <SecretRequestCard
              {request}
              {workspaceId}
              {agentId}
              listedState={state}
              bind:value={values[request.requestId]}
              onHide={request.requestId === leadRequestId ? hide : undefined}
            />
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
