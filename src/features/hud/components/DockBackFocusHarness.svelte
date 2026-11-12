<script lang="ts">
  import DockConversationSurface from './DockConversationSurface.svelte';

  // A conversation switch with no composer focus request: the surface parks focus on Back.
  let workspaceId = $state('ws-a');
</script>

<button
  type="button"
  data-testid="switch"
  onclick={() => (workspaceId = workspaceId === 'ws-a' ? 'ws-b' : 'ws-a')}
>
  Switch conversation
</button>
<div style="width: 320px; height: 240px;">
  <DockConversationSurface {workspaceId}>
    <button type="button" data-dock-conversation-back aria-label="Go back">←</button>
  </DockConversationSurface>
</div>
