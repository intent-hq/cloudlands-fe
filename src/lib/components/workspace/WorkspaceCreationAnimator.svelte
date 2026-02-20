<script lang="ts">
  import { onMount } from 'svelte';
  import AuggieAvatar from '$lib/components/ui/auggie-avatar/AuggieAvatar.svelte';
  import { createCrossfade } from '$lib/utils/crossfade';

  // Props
  interface Props {
    onComplete?: () => void;
    agentId?: string;
  }

  let { onComplete, agentId = 'workspace-initial-agent' }: Props = $props();

  // Animation state
  let showOverlay = $state(true);
  let showBorders = $state(false);
  let startCrossfade = $state(false);
  let hideOverlay = $state(false);

  // Animation timing constants (in ms)
  const BORDER_DELAY = 0;
  const CROSSFADE_DELAY = 400;
  const HIDE_OVERLAY_DELAY = 1600;
  const FADE_DURATION = 300;

  // Create crossfade for smooth transitions
  const [send, receive] = createCrossfade(800);

  // Start animation sequence
  function startAnimation() {
    // Step 1: Show borders immediately
    setTimeout(() => {
      showBorders = true;
    }, BORDER_DELAY);

    // Step 2: Start crossfade after borders animate
    setTimeout(() => {
      startCrossfade = true;
    }, CROSSFADE_DELAY);

    // Step 3: Hide overlay to reveal workspace
    setTimeout(() => {
      hideOverlay = true;
      // Complete after fade
      setTimeout(() => {
        showOverlay = false;
        onComplete?.();
      }, FADE_DURATION);
    }, HIDE_OVERLAY_DELAY);
  }

  onMount(() => {
    startAnimation();
  });
</script>

<!-- Animation overlay -->
{#if showOverlay}
  <div
    class="fixed inset-0 bg-background z-[100] overflow-hidden transition-opacity duration-300"
    class:opacity-0={hideOverlay}
  >
    <!-- Animated borders -->
    {#if showBorders}
      <!-- Sidebar border -->
      <div class="absolute left-[240px] top-0 w-[1px] bg-border border-animation-vertical"></div>

      <!-- Content drawer border (when drawer is open) -->
      <div class="absolute right-[400px] top-0 w-[1px] bg-border border-animation-vertical"></div>

      <!-- Dock border -->
      <div class="absolute right-[48px] top-0 w-[1px] bg-border border-animation-vertical"></div>

      <!-- Header bottom border - using correct header height variable -->
      <div
        class="absolute top-[var(--header-height)] left-0 h-[1px] bg-border border-animation-horizontal"
      ></div>
    {/if}

    <!-- Crossfade elements - receive from form -->
    {#if startCrossfade}
      <!-- Avatar in agent position (top right) -->
      <div
        class="absolute top-[calc(var(--header-height)+1rem)] right-[420px] z-40"
        in:receive={{ key: 'auggie-avatar' }}
      >
        <AuggieAvatar faceSeed={agentId} colorSeed={agentId} size={32} />
      </div>

      <!-- Welcome text will be shown in the agent chat panel itself -->
      <div
        class="absolute top-[calc(var(--header-height)+1rem)] right-[120px] w-[280px] z-40 opacity-0"
        in:receive={{ key: 'welcome-text' }}
      >
        <!-- Empty receiver for crossfade -->
      </div>
    {/if}
  </div>
{/if}

<style>
  @keyframes borderGrowVertical {
    from {
      height: 0;
    }
    to {
      height: 100%;
    }
  }

  @keyframes borderGrowHorizontal {
    from {
      width: 0;
    }
    to {
      width: 100%;
    }
  }

  .border-animation-vertical {
    animation: borderGrowVertical 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
  }

  .border-animation-horizontal {
    animation: borderGrowHorizontal 0.6s cubic-bezier(0.4, 0, 0.2, 1) 0.3s forwards;
    width: 0;
  }
</style>
