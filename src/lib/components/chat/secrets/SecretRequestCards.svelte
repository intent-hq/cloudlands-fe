<script lang="ts">
  /**
   * Composer-slot stack of open secret-request cards (PROTOCOL §5.56).
   * Requests the agent's names-only `secret.list` when the agent, its set of
   * transcript requests or the daemon connection changes, to tell pending
   * cards from expired ones and to find pending requests whose card is outside
   * the loaded page. Hide collapses the stack to one chip, like the Q&A
   * card; a new request expands it again. Values never pass through here.
   */
  import { tick, untrack } from 'svelte';
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
  import { selectPrincipalActionContext } from '$store/renderer/slices/principal/principal-selectors';
  import CollapsedCardChip from '../CollapsedCardChip.svelte';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import SecretRequestDismissDialog from './SecretRequestDismissDialog.svelte';
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
  }

  let { transcript, workspaceId, agentId }: Props = $props();

  const secretRequests$ = selectSecretRequestsState();
  const admissionRevision = $derived($secretRequests$.admissionRevision ?? 0);
  const connectionGeneration$ = selectDaemonConnectionGeneration();
  const principalContext$ = selectPrincipalActionContext();
  type Owner = { admission: string; revision: number; dispatch: typeof appStore.dispatch };
  let owner = $state<Owner | null>(null);

  function isCurrent(expected: Owner | null): boolean {
    try {
      return (
        !!expected &&
        appStore.dispatch === expected.dispatch &&
        (appStore.state.secretRequests.admissionRevision ?? 0) === expected.revision &&
        selectPrincipalActionContext.select(appStore.state) === expected.admission
      );
    } catch {
      return false;
    }
  }
  const visible = $derived(
    visibleSecretRequests(
      transcript,
      agentId,
      $secretRequests$.listings[agentId],
      $secretRequests$.hidden,
    ),
  );

  const answers = $derived($secretRequests$.answers);
  const collapsedKeys = $derived($secretRequests$.collapsed[agentId]);
  const awaiting = $derived(awaitingSecretRequests(visible, answers));
  const collapsed = $derived(showSecretStackChip(visible, answers, collapsedKeys));
  // The chip offers Dismiss only for a single waiting request, like the Q&A
  // chip; with several, the user expands the stack to choose.
  const chipRequest = $derived.by(() => {
    if (!collapsed || awaiting.length !== 1) return null;
    const [only] = awaiting;
    if (only.state !== 'pending') return null;
    return answers[only.request.requestId]?.status === 'sending' ? null : only.request;
  });
  // The chip's dismiss confirmation is bound to the exact request it was
  // opened for; it closes as soon as the chip shows anything else.
  let chipDismissTarget = $state<{
    workspaceId: string;
    agentId: string;
    requestId: string;
    name: string;
    owner: Owner;
  } | null>(null);
  let stackElement = $state<HTMLDivElement>();
  let chipExpandButton = $state<HTMLElement | null>(null);
  let focusAfter = $state<'chip' | 'cards' | null>(null);
  let focusFrom = $state<Element | null>(null);

  $effect(() => {
    const target = chipDismissTarget;
    void $principalContext$;
    if (
      target &&
      (!isCurrent(target.owner) ||
        target.workspaceId !== workspaceId ||
        target.agentId !== agentId ||
        target.requestId !== chipRequest?.requestId)
    )
      chipDismissTarget = null;
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
    const focusOwner = owner;
    void collapsed;
    if (!target || !root || !isCurrent(focusOwner)) return;
    const previousFocus = focusFrom;
    void tick().then(() => {
      if (
        focusAfter !== target ||
        focusFrom !== previousFocus ||
        stackElement !== root ||
        !root.isConnected ||
        !isCurrent(focusOwner)
      )
        return;
      if (
        document.activeElement !== previousFocus &&
        document.activeElement !== document.body &&
        !root.contains(document.activeElement)
      )
        return;
      const element =
        target === 'chip'
          ? chipExpandButton
          : root.querySelector<HTMLElement>(
              '[data-testid="secret-request-input"]:not([disabled]), [data-testid="secret-request-card"] button:not([disabled])',
            );
      if (element) {
        element.focus();
        if (document.activeElement === element) focusAfter = null;
      }
    });
  });

  function hide(): void {
    if (!isCurrent(owner)) return;
    focusFrom = document.activeElement;
    focusAfter = 'chip';
    appStore.dispatch(
      secretRequestsCollapsed(
        agentId,
        visible.map(({ cardKey }) => cardKey),
      ),
    );
  }

  function expand(): void {
    if (!isCurrent(owner)) return;
    focusFrom = document.activeElement;
    focusAfter = 'cards';
    appStore.dispatch(secretRequestsExpanded(agentId));
  }

  function openChipDismiss(): void {
    if (!chipRequest || !owner || !isCurrent(owner)) return;
    chipDismissTarget = {
      workspaceId,
      agentId,
      requestId: chipRequest.requestId,
      name: chipRequest.name,
      owner,
    };
  }

  function dismissChipRequest(target: NonNullable<typeof chipDismissTarget>): void {
    if (chipDismissTarget !== target) return;
    chipDismissTarget = null;
    if (
      !isCurrent(target.owner) ||
      target.workspaceId !== workspaceId ||
      target.agentId !== agentId ||
      target.requestId !== chipRequest?.requestId
    )
      return;
    appStore.dispatch(
      secretAnswerRequested({
        workspaceId: target.workspaceId,
        agentId: target.agentId,
        requestId: target.requestId,
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
    const admission = $principalContext$;
    const revision = admissionRevision;
    const key = requestKey;
    const workspace = workspaceId;
    const agent = agentId;
    owner = admission ? { admission, revision, dispatch: appStore.dispatch } : null;
    chipDismissTarget = null;
    focusAfter = null;
    focusFrom = null;
    if (!isCurrent(owner)) return;
    untrack(() => {
      appStore.dispatch(secretListRequested(workspace, agent, key ? key.split(',') : []));
    });
  });
</script>

{#if visible.length > 0}
  <div
    bind:this={stackElement}
    class="flex w-full flex-col gap-2 px-4 pb-2"
    data-testid="secret-request-cards"
  >
    {#if collapsed}
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
              label: m.chat_secretRequest_dismiss_label(),
              tooltip: m.chat_secretRequest_dismiss_tooltip(),
              onDismiss: openChipDismiss,
              testId: 'secret-request-chip-dismiss',
            }
          : undefined}
      />
    {:else}
      {#each visible as { request, state } (request.requestId)}
        <SecretRequestCard {request} {workspaceId} {agentId} listedState={state} onHide={hide} />
      {/each}
    {/if}
  </div>
{/if}

{#if chipDismissTarget}
  {@const target = chipDismissTarget}
  <SecretRequestDismissDialog
    open
    name={target.name}
    onConfirm={() => dismissChipRequest(target)}
    onCancel={() => {
      if (chipDismissTarget === target) chipDismissTarget = null;
    }}
  />
{/if}
