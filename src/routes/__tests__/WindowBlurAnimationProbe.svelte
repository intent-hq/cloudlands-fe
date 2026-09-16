<script lang="ts">
  import { onMount } from 'svelte';
  import { pauseWindowAnimations } from '$lib/actions/pause-window-animations';
  import '../../app.css';

  onMount(() => {
    const animations = pauseWindowAnimations(document.documentElement);
    return () => animations.destroy();
  });
</script>

<div data-testid="ambient-animation-probe"></div>

<style>
  div {
    width: 1rem;
    height: 1rem;
    animation: ambient-probe 10s linear infinite;
  }

  @keyframes ambient-probe {
    to {
      transform: rotate(1turn);
    }
  }
</style>
