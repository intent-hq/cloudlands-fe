<script lang="ts">
  import { untrack } from 'svelte';
  import DesktopConsentCard from './DesktopConsentCard.svelte';
  import { selectDesktopEntry } from '$store/renderer/slices/desktop-control/desktop-control-selectors';
  import { desktopDecisionRequested } from '$store/renderer/slices/desktop-control/desktop-control-slice';
  import { store } from '$store/renderer/store';
  let {
    workspaceId,
    agentId,
    requestId,
  }: { workspaceId: string; agentId: string; requestId: string } = $props();
  const entry = selectDesktopEntry(
    untrack(() => workspaceId),
    untrack(() => agentId),
  );
</script>

{#if $entry?.pending?.requestId === requestId}
  <DesktopConsentCard
    request={$entry.pending}
    pending={$entry.submitting}
    settingUp={$entry.settingUp}
    guidance={$entry.error}
    onDecision={(decision) =>
      store.dispatch(desktopDecisionRequested(workspaceId, agentId, requestId, decision))}
  />
{/if}
