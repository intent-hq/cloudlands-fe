<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { SecretRequestCardState } from './pending-secret-requests';

  type Scene = 'pending' | 'states' | 'failed' | 'collapsed' | 'collapsed-many';

  interface Props {
    scene?: Scene;
  }

  export const preview = definePreview<Props>({
    id: 'secret-request-card',
    title: 'Agent secret request cards',
    defaultState: 'pending',
    states: {
      pending: { props: { scene: 'pending' } },
      states: { props: { scene: 'states' } },
      failed: { props: { scene: 'failed' } },
      collapsed: { props: { scene: 'collapsed' } },
      'collapsed-many': { props: { scene: 'collapsed-many' } },
    },
  });

  export const STATE_ORDER: SecretRequestCardState[] = [
    'checking',
    'pending',
    'provided',
    'declined',
    'expired',
  ];
</script>

<script lang="ts">
  import type { AgentMessage } from '$shared/types';
  import { SECRET_REQUEST_RESOURCE_MIME_TYPE } from '$shared/types/secret-request-resource';
  import { store } from '$store/renderer/store';
  import {
    secretAnswerUpdated,
    secretListLoaded,
    secretRequestsCollapsed,
  } from '$store/renderer/slices/secret-requests/secret-requests-slice';
  import SecretRequestCard from './SecretRequestCard.svelte';
  import SecretRequestCards from './SecretRequestCards.svelte';
  import SecretRequestNotice from './SecretRequestNotice.svelte';
  import { deriveSecretRequestTranscript } from './pending-secret-requests';

  let { scene = 'pending' }: Props = $props();

  const request = (requestId: string, name = 'OPENROUTER_API_KEY') => ({
    requestId,
    agentId: 'preview-agent',
    name,
    reason: 'Needed to run the integration tests against OpenRouter.',
  });

  store.dispatch(secretAnswerUpdated('sec-preview-failed', 'failed', 1));

  // A collapsed stack per scene: one request, or three.
  const stack = (agentId: string, names: string[], collapse = true) => {
    const ids = names.map((_, index) => `sec-${agentId}-${index}`);
    store.dispatch(
      secretListLoaded(
        agentId,
        {
          secrets: [],
          pendingRequests: ids.map((requestId, index) => ({ requestId, name: names[index] })),
          answeredRequests: [],
        },
        ids,
        0,
      ),
    );
    if (collapse)
      store.dispatch(
        secretRequestsCollapsed(
          agentId,
          ids.map((requestId) => `${requestId}@m-${agentId}`),
        ),
      );
    const message = {
      id: `m-${agentId}`,
      role: 'assistant',
      contentBlocks: ids.map((requestId, index) => ({
        type: 'resource',
        resource: {
          uri: `intent-secret-request://${requestId}`,
          name: names[index],
          mimeType: SECRET_REQUEST_RESOURCE_MIME_TYPE,
          text: JSON.stringify({ ...request(requestId, names[index]), agentId }),
        },
      })),
    } as unknown as AgentMessage;
    return deriveSecretRequestTranscript([message]);
  };
  const expanded = stack('preview-expanded', ['OPENROUTER_API_KEY'], false);
  const collapsedOne = stack('preview-collapsed', ['OPENROUTER_API_KEY']);
  const collapsedMany = stack('preview-collapsed-many', [
    'OPENROUTER_API_KEY',
    'GITHUB_TOKEN',
    'SENTRY_DSN',
  ]);
</script>

<div class="flex w-full max-w-xl flex-col gap-2 bg-background p-4 text-foreground">
  {#if scene === 'pending'}
    <SecretRequestCards transcript={expanded} workspaceId="preview" agentId="preview-expanded" />
  {:else if scene === 'failed'}
    <SecretRequestCard
      request={request('sec-preview-failed')}
      workspaceId="preview"
      agentId="preview-agent"
      listedState="pending"
    />
  {:else if scene === 'collapsed'}
    <SecretRequestCards
      transcript={collapsedOne}
      workspaceId="preview"
      agentId="preview-collapsed"
    />
  {:else if scene === 'collapsed-many'}
    <SecretRequestCards
      transcript={collapsedMany}
      workspaceId="preview"
      agentId="preview-collapsed-many"
    />
  {:else}
    {#each STATE_ORDER as state (state)}
      <SecretRequestCard
        request={request(`sec-preview-${state}`, `${state.toUpperCase()}_TOKEN`)}
        workspaceId="preview"
        agentId="preview-agent"
        listedState={state}
      />
    {/each}
    <SecretRequestNotice
      notice={{ outcome: 'provided', requestId: 'sec-n1', name: 'PROVIDED_TOKEN' }}
    />
    <SecretRequestNotice
      notice={{ outcome: 'declined', requestId: 'sec-n2', name: 'DECLINED_TOKEN' }}
    />
  {/if}
</div>
