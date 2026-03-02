<script lang="ts">
  import { agentFollowStore } from '$features/agent/agent-follow.store.svelte';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';

  let isFollowing = $derived(agentFollowStore.isFollowing);
  let followedAgent = $derived(agentFollowStore.followedAgent);
  let agentColor = $derived(agentFollowStore.agentColor);
  let currentFile = $derived(agentFollowStore.currentFile);
  let animationQueue = $derived(agentFollowStore.animationQueue);
</script>

{#if isFollowing && followedAgent}
  <div
    class="fixed bottom-4 right-4 z-50"
    transition:fly={{ y: 20, duration: 300, easing: cubicOut }}
  >
    <div
      class="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg p-3 min-w-[250px]"
      style="border-color: {agentColor?.start}"
    >
      <!-- Header -->
      <div class="flex items-center gap-2 mb-2">
        <div class="relative">
          <div
            class="w-2 h-2 rounded-full animate-pulse"
            style="background: {agentColor?.gradient}"
          ></div>
        </div>
        <span class="text-sm font-medium">Following {followedAgent.name}</span>
      </div>

      <!-- Current Activity -->
      {#if currentFile}
        <div class="text-xs text-subtle mb-1">
          Editing: <span class="font-mono">{currentFile.split('/').pop()}</span>
        </div>
      {/if}

      <!-- Animation Queue Status -->
      {#if animationQueue.length > 0}
        <div class="flex items-center gap-1 text-xs text-subtle">
          <svg class="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="2"
              stroke-dasharray="60 40"
            />
          </svg>
          <span
            >Processing {animationQueue.length} change{animationQueue.length !== 1
              ? 's'
              : ''}...</span
          >
        </div>
      {/if}

      <!-- Stop Following Button -->
      <button
        onclick={() => agentFollowStore.stopFollowing()}
        class="mt-2 w-full text-xs py-1 px-2 rounded bg-muted hover:bg-muted/80 transition-colors"
      >
        Stop Following
      </button>
    </div>
  </div>
{/if}

<style>
  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }

  .animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
  }
</style>
