<script lang="ts">
  /**
   * Composer-slot stack of open secret-request cards (PROTOCOL §5.56).
   * Requests the agent's names-only `secret.list` when the agent, its set of
   * transcript requests or the daemon connection changes, to tell pending
   * cards from expired ones and to find pending requests whose card is outside
   * the loaded page. Values never pass through here.
   */
  import { untrack } from 'svelte';
  import { secretListRequested } from '$store/renderer/slices/secret-requests/secret-requests-slice';
  import { selectSecretRequestsState } from '$store/renderer/slices/secret-requests/secret-requests-selectors';
  import { selectDaemonConnectionGeneration } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { store as appStore } from '$store/renderer/store';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import { visibleSecretRequests, type SecretRequestTranscript } from './pending-secret-requests';

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
    {#each visible as { request, state } (request.requestId)}
      <SecretRequestCard {request} {workspaceId} {agentId} listedState={state} />
    {/each}
  </div>
{/if}
