<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'workspace-safety-audit',
    title: 'Workspace safety audit',
    defaultState: 'delete-all',
    states: Object.fromEntries(
      [
        'delete-empty',
        'delete-inactive',
        'archive-inactive',
        'delete-all',
        'delete-long',
        'delete-multiple-roots',
        'archive-all',
        'bulk-archive',
        'bulk-delete',
        'bulk-busy',
        'bulk-error',
        'recovery-none',
        'recovery-some',
        'recovery-abandon',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import DeleteWarningDialog from './DeleteWarningDialog.svelte';
  import BulkActionConfirmDialog from './BulkActionConfirmDialog.svelte';
  import InterruptedAgentsModal from './InterruptedAgentsModal.svelte';
  import type { LocalChangesWarning } from '$store/renderer/slices/workspace-operations/workspace-operations-types';
  let { state = 'delete-all' }: { state?: string } = $props();
  const localChanges = $derived<LocalChangesWarning>({
    hasUnpushedCommits: true,
    hasUncommittedChanges: true,
    roots: [
      {
        kind: 'primary',
        path: '/fixture/workspace',
        branch: 'refine-modals',
        hasRemoteRefs: true,
        unpushedCount: 2,
        uncommittedCount: 3,
      },
      ...(state === 'delete-multiple-roots'
        ? [
            {
              kind: 'secondary' as const,
              gitRootId: 'frontend',
              path: '/fixture/workspace/packages/frontend',
              branch: 'design-system',
              hasRemoteRefs: true,
              unpushedCount: 1,
              uncommittedCount: 2,
            },
          ]
        : []),
    ],
  });
</script>

{#if state.startsWith('recovery-')}
  <InterruptedAgentsModal
    open
    agents={['Design system', 'Release prep', 'Documentation'].map((name, index) => ({
      agentId: `agent-${index}`,
      agentName: 'Implementor',
      workspaceId: `workspace-${index}`,
      workspaceName: name,
      prevStatus: 'running',
      interruptedAt: '2026-09-22T00:00:00Z',
    }))}
  />
{:else if state.startsWith('bulk-')}
  <BulkActionConfirmDialog
    open
    title={state === 'bulk-delete' ? 'Delete selected workspaces?' : 'Archive selected workspaces?'}
    description={state === 'bulk-delete'
      ? 'The selected workspaces will be permanently deleted.'
      : 'The selected workspaces will move to the archive.'}
    confirmText={state === 'bulk-delete' ? 'Delete workspaces' : 'Archive workspaces'}
    variant="destructive"
    activeAgentCount={2}
    activeHookCount={1}
    onConfirm={async () => {
      if (state === 'bulk-busy') await new Promise<void>(() => {});
      if (state === 'bulk-error') throw new Error('Unable to archive these workspaces. Try again.');
    }}
  />
{:else}
  <DeleteWarningDialog
    open
    mode={state.startsWith('archive-') ? 'archive' : 'delete'}
    agents={state === 'delete-empty' || state.endsWith('-inactive')
      ? []
      : Array.from({ length: state === 'delete-long' ? 12 : 2 }, (_, index) => ({
          id: `agent-${index}`,
          name:
            state === 'delete-long'
              ? `Implementor with a very long role description ${index + 1}`
              : index
                ? 'Verifier'
                : 'Implementor',
          specialist: 'implementor',
          state: 'running' as const,
        }))}
    hookNames={state === 'delete-empty' || state.endsWith('-inactive')
      ? []
      : ['Watch release build']}
    openPrs={state === 'delete-empty'
      ? []
      : [{ number: 418, title: 'Refine modal catalog', status: 'Open', url: '' }]}
    localChanges={state === 'delete-empty' ? null : localChanges}
  />
{/if}
