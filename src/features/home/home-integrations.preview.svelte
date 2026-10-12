<script lang="ts" module>
  import { definePreview } from '$lib/component-catalog/preview-definition';
  interface Props {
    scenario?: string;
    height?: number;
  }
  export const preview = definePreview<Props>({
    id: 'home-integrations',
    title: 'Home integrations',
    defaultState: 'prs',
    states: Object.fromEntries(
      [
        'prs',
        'linked-prs',
        'linear',
        'empty',
        'disconnected',
        'error',
        'loading',
        'detail-error',
        'comments-error',
        'pagination-error',
        'checks-mixed',
        'checks-passed',
        'checks-neutral',
        'checks-cancelled',
        'checks-empty',
        'checks-loading',
        'checks-error',
        'files-long',
        'files-empty',
      ].map((scenario) => [scenario, { props: { scenario } }]),
    ),
  });
</script>

<script lang="ts">
  import { onDestroy } from 'svelte';
  import { WorkspaceId } from '$shared/types/branded-ids';
  import { WorkspaceStatus, type Workspace } from '$shared/types';
  import Harness from './home-integrations-harness.svelte';
  import { startHomePreview } from './home-preview-lifecycle';
  import HomeIntegrations from './HomeIntegrations.svelte';
  import { homeIntegrationsFixtures } from './home-integrations-fixtures';
  const linkedWorkspaces: Workspace[] = [
    {
      id: WorkspaceId('home-linked-service'),
      title: 'Service integration',
      branch: 'feat/service',
      status: WorkspaceStatus.Active,
      repositoryOwner: 'acme',
      repositoryName: 'studio',
      createdAt: '2026-09-28T20:00:00Z',
      updatedAt: '2026-09-28T22:10:00Z',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      prUrl: 'https://github.com/other/service/pull/901',
    },
  ];
  let { scenario = 'prs', height = 720 }: Props = $props();
  const dispose = startHomePreview(() => []);
  onDestroy(dispose);
  const state = $derived(homeIntegrationsFixtures[scenario] ?? homeIntegrationsFixtures.prs);
</script>

<div class="w-full bg-background text-foreground" style:height={`${height}px`}>
  {#key scenario}{#if scenario === 'linked-prs'}<Harness
        repoCount={1}
        workspaces={linkedWorkspaces}
      />{:else}<HomeIntegrations
        kind={scenario === 'linear' ? 'linear' : 'prs'}
        repositories={state.scope?.repositories ?? []}
        preview={state}
      />{/if}{/key}
</div>
