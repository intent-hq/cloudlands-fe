<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  export const preview = definePreview({
    id: 'modal-polish',
    title: 'Modal layout and alignment',
    defaultState: 'recovery',
    states: {
      recovery: { props: { state: 'recovery' } },
      'recovery-single': { props: { state: 'recovery-single' } },
      'recovery-many': { props: { state: 'recovery-many' } },
      'recovery-long': { props: { state: 'recovery-long' } },
      'recovery-busy': { props: { state: 'recovery-busy' } },
      'recovery-error': { props: { state: 'recovery-error' } },
      'recovery-partial': { props: { state: 'recovery-partial' } },
      'recovery-empty': { props: { state: 'recovery-empty' } },
      handoff: { props: { state: 'handoff' } },
      form: { props: { state: 'form' } },
      transfer: { props: { state: 'transfer' } },
      harness: { props: { state: 'harness' } },
    },
  });
</script>

<script lang="ts">
  import InterruptedAgentsModal from './InterruptedAgentsModal.svelte';
  import ReplaceAgentModal from './ReplaceAgentModal.svelte';
  import TransferWorkspaceModal from './TransferWorkspaceModal.svelte';
  import HarnessFeaturesModal from '$lib/components/chat/HarnessFeaturesModal.svelte';
  import { FormDialog } from '$lib/components/patterns/confirm';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  let { state: previewState = 'recovery' }: { state?: string } = $props();
  let open = $state(true);
  let name = $state('Design system');
  let destination = $state<{ kind: 'download' } | null>(null);
  const edgeAgents = $derived(
    Array.from(
      {
        length:
          previewState === 'recovery-empty'
            ? 0
            : previewState === 'recovery-single'
              ? 1
              : previewState === 'recovery-many'
                ? 60
                : 8,
      },
      (_, index) => ({
        agentId: `edge-agent-${index}`,
        agentName: `Agent ${index + 1}`,
        workspaceId: `workspace-${previewState === 'recovery-many' ? Math.floor(index / 3) : index < 6 ? 0 : 1}`,
        workspaceName:
          previewState === 'recovery-long'
            ? `A very long workspace name for the cross-component migration and accessibility review ${index < 6 ? 1 : 2}`
            : `Workspace ${previewState === 'recovery-many' ? Math.floor(index / 3) + 1 : index < 6 ? 1 : 2}`,
        prevStatus: 'running',
        interruptedAt: '2026-09-11T12:00:00Z',
      }),
    ),
  );
</script>

{#if previewState.startsWith('recovery-')}
  <InterruptedAgentsModal
    inline
    bind:open
    agents={edgeAgents}
    onResumeSelected={async (ids) => {
      if (previewState === 'recovery-busy') await new Promise<void>(() => {});
      if (previewState === 'recovery-error') throw new Error('Preview request failed');
      if (previewState === 'recovery-partial')
        return {
          resumed: ids.slice(0, -1),
          abandoned: [],
          failed: [{ agentId: ids.at(-1)!, error: 'Preview unavailable' }],
        };
    }}
  />
{:else if previewState === 'recovery'}
  <InterruptedAgentsModal
    inline
    bind:open
    agents={[
      ...Array.from({ length: 4 }, (_, index) => ({
        agentId: `design-agent-${index}`,
        agentName: `Design agent ${index + 1}`,
        workspaceId: 'design',
        workspaceName: 'Design system',
        prevStatus: 'running',
        interruptedAt: '2026-09-11T12:00:00Z',
      })),
      {
        agentId: 'implementor',
        agentName: 'Implementor',
        workspaceId: 'design',
        workspaceName: 'Design system',
        prevStatus: 'running',
        interruptedAt: '2026-09-11T12:00:00Z',
      },
      {
        agentId: 'reviewer',
        agentName: 'Reviewer',
        workspaceId: 'release',
        workspaceName: 'Release prep',
        prevStatus: 'waiting',
        interruptedAt: '2026-09-11T12:00:00Z',
      },
    ]}
    onResumeSelected={() => {}}
  />
{:else if previewState === 'handoff'}
  <ReplaceAgentModal
    static
    bind:open
    agentName="Catalog implementor"
    specialist="implementor"
    onCancel={() => (open = false)}
    onSend={() => {}}
  />
{:else if previewState === 'transfer'}
  <TransferWorkspaceModal
    open
    static
    workspaceTitle="Design system"
    {destination}
    onSelectDestination={(value) => {
      if (value.kind === 'download') destination = value;
    }}
  />
{:else if previewState === 'harness'}
  <HarnessFeaturesModal
    open
    static
    version="2.3"
    features={{ browserAutomation: true, backgroundHooks: true, structuredQuestions: true }}
  />
{:else}
  <FormDialog
    static
    bind:open
    title="Edit workspace"
    description="Update the name shown in your workspace list."
    size="lg"
    submitLabel="Save changes"
    onSubmit={() => {
      open = false;
    }}
  >
    <div class="grid gap-2">
      <Label for="polish-workspace-name">Workspace name</Label>
      <Input id="polish-workspace-name" bind:value={name} />
    </div>
  </FormDialog>
{/if}
