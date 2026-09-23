<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview<{ state: string }>({
    id: 'transfer-audit',
    title: 'Transfer and import states',
    defaultState: 'plan',
    states: Object.fromEntries(
      [
        'destination',
        'plan',
        'plan-loading',
        'plan-error',
        'download-plan',
        'building',
        'relaying',
        'committing',
        'success',
        'failure',
        'finalizing',
        'finalize-error',
        'download-success',
        'import-reading',
        'import-uploading',
        'import-committing',
        'import-success',
        'import-interrupted',
        'import-failure',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import TransferWorkspaceModal from './TransferWorkspaceModal.svelte';
  import ImportWorkspaceModal from './ImportWorkspaceModal.svelte';
  import type { TransferPlan } from '$store/renderer/slices/workspace-transfer/workspace-transfer-types';
  let { state = 'plan' }: { state?: string } = $props();
  const plan: TransferPlan = {
    manifest: {
      formatVersion: 1,
      creatingIntentdVersion: 'preview',
      workspaceId: 'audit',
      createdAt: '2026-09-22T00:00:00Z',
      tables: [{ name: 'agents', rowCount: 12, approxBytes: 2048 }],
      assets: [{ id: 'screenshot.png', sizeBytes: 4096 }],
      git: {
        hasRepository: true,
        branch: 'design-system',
        dirtyFiles: ['src/theme.css'],
        sandboxBranches: [],
      },
    },
    totalSizeBytes: 1048576,
    dbRowBytes: 2048,
    assetBytes: 4096,
    estimatedGitBundleBytes: 1042432,
    warnings: [
      { code: 'running-agents', message: 'Two running agents will stop during transfer.' },
    ],
  };
  const transferring = $derived(['building', 'relaying', 'committing'].includes(state));
  const result = $derived(
    ['success', 'failure', 'finalizing', 'finalize-error', 'download-success'].includes(state),
  );
</script>

{#if state.startsWith('import-')}
  <ImportWorkspaceModal
    open
    static
    workspaceTitle="Design system"
    step={['import-success', 'import-interrupted', 'import-failure'].includes(state)
      ? 'result'
      : 'importing'}
    runStatus={state === 'import-failure'
      ? 'failed'
      : ['import-success', 'import-interrupted'].includes(state)
        ? 'succeeded'
        : 'running'}
    progress={{
      phase:
        state === 'import-committing'
          ? 'committing'
          : state === 'import-uploading'
            ? 'uploading'
            : 'reading',
      bytesTotal: 1048576,
      bytesUp: 524288,
      chunksDone: 1,
    }}
    runError="Connection closed before the import finished."
    interruptedAgents={state === 'import-interrupted' ? ['agent-1', 'agent-2'] : []}
  />
{:else}
  <TransferWorkspaceModal
    open
    static
    workspaceTitle="Design system"
    step={state === 'destination'
      ? 'destination'
      : transferring
        ? 'transferring'
        : result
          ? 'result'
          : 'confirm'}
    destination={state.startsWith('download-')
      ? { kind: 'download' }
      : { kind: 'server', connectionId: 'team' }}
    {plan}
    planStatus={state === 'plan-loading' ? 'loading' : state === 'plan-error' ? 'error' : 'loaded'}
    planError="The destination server is unavailable."
    runStatus={state === 'failure'
      ? 'failed'
      : result
        ? 'succeeded'
        : transferring
          ? 'running'
          : 'idle'}
    runError="Connection closed while uploading the archive."
    progress={{
      phase: state === 'committing' ? 'committing' : state === 'relaying' ? 'relaying' : 'building',
      bytesTotal: 1048576,
      bytesDown: 1048576,
      bytesUp: 524288,
      chunksDone: 1,
    }}
    finalizeStatus={state === 'finalizing'
      ? 'running'
      : state === 'finalize-error'
        ? 'error'
        : 'idle'}
    finalizeError="The source workspace could not be archived."
    downloadFilePath="/Downloads/design-system.intent.zip"
    interruptedAgents={result ? ['agent-1', 'agent-2'] : []}
  />
{/if}
