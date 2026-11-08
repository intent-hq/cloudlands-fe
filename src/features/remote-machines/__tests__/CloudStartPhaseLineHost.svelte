<!-- The chat's working row and conversation notice, wired as ChatPanel wires them. -->
<script lang="ts">
  import { readable } from 'svelte/store';
  import StreamingStatus from '$lib/components/chat/StreamingStatus.svelte';
  import { AgentStatus } from '$shared/types';
  import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
  import AgentPlacementNotice from '../AgentPlacementNotice.svelte';
  import { agentCloudStartFailure, agentCloudStarting } from '../agent-location';
  import { StartLineHosts } from '../start-line-hosts.svelte';

  let {
    agentId,
    isProcessing = true,
    statusEvents = [],
    onStop,
  }: {
    agentId: string;
    isProcessing?: boolean;
    statusEvents?: Array<{
      phase: string;
      message: string;
      level: 'info' | 'warn' | 'error';
      timestamp: number;
    }>;
    onStop?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  const agent$ = selectAgentSession(readable(agentId));
  const cloudStarting = $derived(agentCloudStarting($agent$));
  const error = $derived(
    agentCloudStartFailure($agent$)
      ? null
      : $agent$?.status === AgentStatus.Error
        ? ($agent$.stopReason ?? 'failed')
        : null,
  );
  const startLineHosts = new StartLineHosts();
</script>

{#snippet cloudStartLine()}
  <AgentPlacementNotice {agentId} phaseLine onPhaseLine={startLineHosts.register} />
{/snippet}

<div data-testid="working-row">
  <StreamingStatus
    {isProcessing}
    {error}
    {statusEvents}
    {onStop}
    startLine={cloudStarting ? cloudStartLine : null}
  />
</div>
<div data-testid="conversation-notice">
  <AgentPlacementNotice {agentId} phaseLineShown={startLineHosts.shown} />
</div>
