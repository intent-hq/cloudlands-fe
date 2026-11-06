<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupWorkspaceFormPreview } from './workspace-form.preview-fixtures';

  interface Props {
    scenario?:
      | 'default'
      | 'long'
      | 'empty'
      | 'config-error'
      | 'orchestration'
      | 'many-repos'
      | 'remote-attachments'
      | 'selection-recovery'
      | 'selection-access-error'
      | 'opening-cold'
      | 'opening-saved'
      | 'opening-stale'
      | 'opening-error'
      | 'opening-empty'
      | 'opening-warm'
      | 'opening-hydration'
      | 'opening-late-prefill';
    modal?: boolean;
  }

  export const preview = definePreview<Props>({
    id: 'workspace-form',
    title: 'New workspace form',
    defaultState: 'default',
    captureReadiness: { selector: '[data-workspace-form-ready=true]' },
    states: {
      default: { props: {}, setup: () => setupWorkspaceFormPreview('default') },
      long: { props: { scenario: 'long' }, setup: () => setupWorkspaceFormPreview('long') },
      empty: { props: { scenario: 'empty' }, setup: () => setupWorkspaceFormPreview('empty') },
      'config-error': {
        props: { scenario: 'config-error' },
        setup: () => setupWorkspaceFormPreview('config-error'),
      },
      orchestration: {
        props: { scenario: 'orchestration' },
        setup: () => setupWorkspaceFormPreview('orchestration'),
      },
      modal: { props: { modal: true } },
      'modal-long': { props: { modal: true, scenario: 'long' } },
      history: { props: { modal: true, scenario: 'many-repos' } },
      'selection-recovery': { props: { modal: true, scenario: 'selection-recovery' } },
      'selection-access-error': { props: { modal: true, scenario: 'selection-access-error' } },
      // Attachments with the first agent on another machine: Machine stays editable.
      'remote-attachments': {
        props: { scenario: 'remote-attachments' },
        setup: () => setupWorkspaceFormPreview('remote-attachments'),
      },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import NewSpaceModal from '$lib/components/modals/NewSpaceModal.svelte';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import {
    selectWorkspaceInitializerGitAvailability,
    selectWorkspaceInitializerHydrated,
  } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';

  let { scenario = 'default', modal = false }: Props = $props();
  let submissions = $state<Array<{ repoPath: string; branch: string; prompt: string }>>([]);
  let openedLinks = $state<string[]>([]);
  let branchRequests = $state<Array<{ repository: string; status: string }>>([]);
  let prefillInitializer: CompactWorkspaceInitializer | null = $state(null);
  let prefillOpen = $state(true);
  let prefillExpanded = $state(true);
  let prefillApplications = $state(0);
  const gitAvailable$ = selectWorkspaceInitializerGitAvailability();
  const hydrated$ = selectWorkspaceInitializerHydrated();
  if (untrack(() => modal)) {
    onDestroy(
      setupWorkspaceFormPreview(
        untrack(() => scenario),
        (url) => {
          openedLinks = [...openedLinks, url];
        },
        (request) => {
          branchRequests = [...branchRequests, request];
        },
        (submission) => {
          submissions = [...submissions, submission];
        },
      ),
    );
  }
  if (untrack(() => scenario === 'opening-late-prefill')) {
    // The public initializer snippet exposes the real component's public API;
    // the fixture never edits its private state or replaces the branch picker.
    const applyLatePrefill = async () => {
      if (!prefillInitializer) throw new Error('The prefill initializer is not mounted');
      await prefillInitializer.applyPrefill();
      prefillApplications++;
    };
    window.addEventListener('workspace-form:apply-late-prefill', applyLatePrefill);
    onDestroy(() => {
      window.removeEventListener('workspace-form:apply-late-prefill', applyLatePrefill);
    });
  }
</script>

{#snippet localPrefillInitializer()}
  <CompactWorkspaceInitializer
    bind:this={prefillInitializer}
    bind:isExpanded={prefillExpanded}
    autoFocus={false}
    defaultToSidebarRepository
    oncreate={() => (prefillOpen = false)}
    onNavigateAway={() => (prefillOpen = false)}
  />
{/snippet}

<div class="w-full min-w-0 p-4" data-workspace-form-ready={$gitAvailable$ === true}>
  {#if scenario === 'opening-late-prefill'}
    <NewSpaceModal bind:open={prefillOpen} initializer={localPrefillInitializer} />
  {:else}
    <NewSpaceModal open static={!modal} />
  {/if}
  <output class="sr-only" data-testid="workspace-external-links"
    >{JSON.stringify(openedLinks)}</output
  >
  <output class="sr-only" data-testid="workspace-branch-requests"
    >{JSON.stringify(branchRequests)}</output
  >
  <output class="sr-only" data-testid="workspace-submissions">{JSON.stringify(submissions)}</output>
  <output class="sr-only" data-testid="workspace-hydrated">{$hydrated$}</output>
  <output class="sr-only" data-testid="workspace-prefill-applications">{prefillApplications}</output
  >
</div>
