<script lang="ts">
  import { onMount } from 'svelte';
  import { pauseWindowAnimations } from '$lib/actions/pause-window-animations';
  import '../../app.css';

  onMount(() => {
    const animations = pauseWindowAnimations(document.documentElement);
    return () => animations.destroy();
  });
</script>

<div class="loop" data-testid="ambient-animation-probe"></div>
<div class="one-shot" data-testid="one-shot-animation-probe"></div>
<div class="short-one-shot" data-testid="short-one-shot-animation-probe"></div>

<style>
  div {
    width: 1rem;
    height: 1rem;
  }

  .loop {
    animation: ambient-probe 10s linear infinite;
  }

  .one-shot {
    animation: one-shot-probe 10s linear both;
  }

  .short-one-shot {
    animation: one-shot-probe 300ms linear both;
  }

  @keyframes ambient-probe {
    to {
      transform: rotate(1turn);
    }
  }

  @keyframes one-shot-probe {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(1rem);
    }
  }
</style>
