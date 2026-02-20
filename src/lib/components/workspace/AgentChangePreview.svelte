<script lang="ts">
  import { agentFollowStore } from '$features/agent/agent-follow.store.svelte';
  import { slide } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';

  interface Change {
    type: 'add' | 'remove' | 'modify';
    file: string;
    line: number;
    content: string;
    timestamp: number;
  }

  let recentChanges: Change[] = $state([]);
  let maxChanges = 5;

  // Track recent changes
  $effect(() => {
    const handleChange = (event: any) => {
      const { file, type, content, line } = event.detail;

      const change: Change = {
        type: type === 'addition' ? 'add' : type === 'deletion' ? 'remove' : 'modify',
        file: file.split('/').pop() || file,
        line: line || 0,
        content: content.substring(0, 100),
        timestamp: Date.now(),
      };

      recentChanges = [
        change,
        ...(Array.isArray(recentChanges) ? recentChanges.slice(0, maxChanges - 1) : []),
      ];

      // Auto-remove old changes after 10 seconds
      setTimeout(() => {
        recentChanges = recentChanges.filter((c) => c.timestamp !== change.timestamp);
      }, 10000);
    };

    window.addEventListener('agent-change', handleChange);
    return () => window.removeEventListener('agent-change', handleChange);
  });

  let isFollowing = $derived(agentFollowStore.isFollowing);
  let agentColor = $derived(agentFollowStore.agentColor);
</script>

{#if isFollowing && recentChanges.length > 0}
  <div class="fixed top-20 right-4 z-40 w-80">
    <div class="bg-background/95 backdrop-blur-sm border rounded-lg shadow-lg overflow-hidden">
      <div
        class="px-3 py-2 border-b text-xs font-medium"
        style="background: linear-gradient(90deg, {agentColor?.start}20, {agentColor?.end}20)"
      >
        Recent Changes
      </div>

      <div class="max-h-64 overflow-y-auto">
        {#each recentChanges as change (change.timestamp)}
          <div
            class="px-3 py-2 border-b last:border-b-0 text-xs"
            transition:slide={{ duration: 200, easing: quintOut }}
          >
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono text-muted-foreground">
                {change.file}:{change.line}
              </span>
              {#if change.type === 'add'}
                <span class="text-green-500">+</span>
              {:else if change.type === 'remove'}
                <span class="text-red-500">-</span>
              {:else}
                <span class="text-yellow-500">~</span>
              {/if}
            </div>

            <div class="font-mono text-[10px] text-muted-foreground/80 truncate">
              {change.content}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
