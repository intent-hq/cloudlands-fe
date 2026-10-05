<script lang="ts">
  import AgentAvatarCatalog from '../AgentAvatarCatalog.svelte';
  import AgentAvatar from '../AgentAvatar.svelte';
  import AgentAvatarWithState from '../AgentAvatarWithState.svelte';
  import type { AvatarState } from '../avatar-state';

  interface Props {
    theme?: 'light' | 'dark';
    state?: AvatarState;
    zoom?: number;
    motionReduced?: boolean;
  }

  let { theme = 'light', state = 'idle', zoom = 1, motionReduced = false }: Props = $props();
</script>

<section
  class:dark={theme === 'dark'}
  class:light={theme === 'light'}
  style:zoom
  style:--motion-reduced={motionReduced ? 1 : 0}
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
  <div data-testid="plain-idle-avatar">
    <AgentAvatar agentId="plain-idle-agent" variant="standard" />
  </div>
  <div data-testid="legacy-sized-avatar">
    <AgentAvatar agentId="legacy-sized-agent" size={18} />
  </div>
  <AgentAvatarCatalog />
</section>
