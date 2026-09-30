<script lang="ts">
  import { store } from '$store/renderer/store';
  import { selectPlacementChoice } from '$store/renderer/slices/workspace-agents/workspace-agents-selectors';
  import { placementChoiceAnswered } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
  import AgentPlacementRequiredDialog from './AgentPlacementRequiredDialog.svelte';
  const choice = selectPlacementChoice();
</script>

{#if $choice}
  {#key $choice.id}
    <AgentPlacementRequiredDialog
      capabilities={$choice.capabilities}
      onanswer={(placement) => {
        if ($choice) store.dispatch(placementChoiceAnswered($choice.id, placement));
      }}
    />
  {/key}
{/if}
