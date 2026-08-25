<script lang="ts">
  import { onDestroy } from 'svelte';
  import AgentAvatarWithState from '$features/agent/components/agent-avatar/AgentAvatarWithState.svelte';
  import AuroraBackground from '../AuroraBackground.svelte';

  let { theme = 'light' }: { theme?: 'light' | 'dark' } = $props();
  const root = document.documentElement;
  const hadLight = root.classList.contains('light');
  const hadDark = root.classList.contains('dark');

  $effect(() => {
    root.classList.toggle('light', theme === 'light');
    root.classList.toggle('dark', theme === 'dark');
  });

  onDestroy(() => {
    root.classList.toggle('light', hadLight);
    root.classList.toggle('dark', hadDark);
  });
</script>

<section class="flex items-center gap-4 bg-background p-4" data-testid="aurora-color-host">
  <div class="h-24 w-80" data-testid="aurora-surface">
    <AuroraBackground />
  </div>
  <AgentAvatarWithState
    agentId="aurora-running-reference"
    specialist="implementor"
    state="running"
    variant="standard"
  />
</section>
