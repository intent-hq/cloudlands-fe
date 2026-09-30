<script lang="ts">
  import { Select } from '$lib/components/ui/select';
  import { m } from '$shared/paraglide/messages.js';
  import type { AgentPlacement } from '$shared/types/agent-node';
  import type { NodeCapabilities } from '../services/node-execution';

  interface Props {
    value?: AgentPlacement | null;
    capabilities: NodeCapabilities;
    remoteEnabled: boolean;
    disabled?: boolean;
    insideDialog?: boolean;
    onchange: (placement: AgentPlacement) => void;
  }
  let {
    value,
    capabilities,
    remoteEnabled,
    disabled = false,
    insideDialog = false,
    onchange,
  }: Props = $props();
  const options = $derived([
    {
      id: 'shared',
      label: m.agent_placement_shared(),
      placement: { target: 'local', checkout: 'shared' } as AgentPlacement,
      disabled: !capabilities.agentNodes,
    },
    {
      id: 'worktree',
      label: m.agent_placement_worktree(),
      placement: { target: 'local', checkout: 'worktree' } as AgentPlacement,
      disabled: !capabilities.agentNodes,
    },
    {
      id: 'isolated',
      label: m.agent_placement_isolated(),
      placement: { target: 'local', checkout: 'isolated' } as AgentPlacement,
      disabled: !capabilities.localNodeIsolation,
    },
    ...(remoteEnabled
      ? [
          {
            id: 'remote',
            label: m.agent_placement_remote(),
            placement: { target: 'remote', checkout: 'isolated' } as AgentPlacement,
            disabled: !capabilities.agentNodes,
          },
        ]
      : []),
  ]);
  const selected = $derived(value?.target === 'remote' ? 'remote' : (value?.checkout ?? ''));
  const label = $derived(
    value?.target === 'remote'
      ? m.agent_placement_remote()
      : (options.find((option) => option.id === selected)?.label ?? m.agent_placement_default()),
  );
  function select(id: string) {
    const option = options.find((entry) => entry.id === id);
    if (
      !option ||
      option.disabled ||
      disabled ||
      (option.placement.target === 'remote' && !remoteEnabled)
    )
      return;
    onchange(option.placement);
  }
</script>

<Select.Root value={selected} {disabled} onchange={select}>
  <Select.Trigger aria-label={m.agent_placement_label()}>{label}</Select.Trigger>
  <Select.Content portal class={insideDialog ? 'z-(--layer-modal)' : undefined}>
    {#each options as option (option.id)}
      <Select.Item value={option.id} disabled={option.disabled}>{option.label}</Select.Item>
    {/each}
  </Select.Content>
</Select.Root>
{#if !capabilities.agentNodes}
  <p class="text-xs text-subtle" role="status">{m.agent_placement_unavailable()}</p>
{:else if value?.target === 'remote' && !remoteEnabled}
  <p class="text-xs text-subtle" role="status">{m.agent_placement_labsRequired()}</p>
{/if}
