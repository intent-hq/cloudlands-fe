<script lang="ts">
  import AgentAvatarCatalog from '../AgentAvatarCatalog.svelte';
  import AgentAvatarWithState from '../AgentAvatarWithState.svelte';
  import type { AvatarState } from '../avatar-state';

  interface Props {
    theme?: 'light' | 'dark';
    state?: AvatarState;
    zoom?: number;
  }

  let { theme = 'light', state = 'idle', zoom = 1 }: Props = $props();
</script>

<section
  class:dark={theme === 'dark'}
  class:light={theme === 'light'}
  style:zoom
  class="w-max bg-background p-4 text-foreground"
>
  <div data-testid="reactive-waiting-avatar">
    <AgentAvatarWithState
      agentId="waiting-state-transition"
      specialist="coordinator"
      {state}
      variant="standard"
    />
  </div>
  <AgentAvatarCatalog />
</section>
