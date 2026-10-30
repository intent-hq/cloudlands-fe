<script lang="ts">
  /**
   * Composer-slot stack of open secret-request cards (PROTOCOL §5.56).
   * Requests the agent's names-only `secret.list` whenever the set of open
   * requests changes, to tell pending cards from expired ones. Values never
   * pass through here.
   */
  import type { SecretRequest } from '$shared/types/secret-request-resource';
  import { secretListRequested } from '$store/renderer/slices/secret-requests/secret-requests-slice';
  import { selectSecretRequestsState } from '$store/renderer/slices/secret-requests/secret-requests-selectors';
  import { store as appStore } from '$store/renderer/store';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import { secretRequestCardState } from './pending-secret-requests';

  interface Props {
    requests: SecretRequest[];
    workspaceId: string;
    agentId: string;
  }

  let { requests, workspaceId, agentId }: Props = $props();

  const secretRequests$ = selectSecretRequestsState();
  const listing = $derived($secretRequests$.listings[agentId] ?? null);

  const requestKey = $derived(requests.map((request) => request.requestId).join(','));

  $effect(() => {
    void requestKey;
    void workspaceId;
    void agentId;
    if (requests.length > 0) appStore.dispatch(secretListRequested(workspaceId, agentId));
  });
</script>

{#if requests.length > 0}
  <div class="flex w-full flex-col gap-2 px-4 pb-2" data-testid="secret-request-cards">
    {#each requests as request (request.requestId)}
      <SecretRequestCard
        {request}
        {workspaceId}
        {agentId}
        listedState={secretRequestCardState(request.requestId, listing)}
      />
    {/each}
  </div>
{/if}
