<script lang="ts">
  import { Skeleton } from './skeleton';
  import Fa from 'svelte-fa';
  import { faCircleNotch } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    type?: 'skeleton' | 'spinner' | 'text';
    message?: string;
    rows?: number;
    class?: string;
  }

  let {
    type = 'skeleton',
    message = 'Loading...',
    rows = 3,
    class: className = '',
  }: Props = $props();
</script>

{#if type === 'skeleton'}
  <div class="space-y-2 {className}">
    {#each Array(rows) as _, i}
      <div class="flex items-center gap-3">
        <Skeleton class="h-4 w-4 flex-shrink-0" />
        <div class="flex-1 space-y-1">
          <Skeleton class="h-4 w-32" />
          {#if i % 2 === 0}
            <Skeleton class="h-3 w-48" />
          {/if}
        </div>
      </div>
    {/each}
  </div>
{:else if type === 'spinner'}
  <div class="flex flex-col items-center justify-center py-8 {className}">
    <Fa icon={faCircleNotch} size="1x" class="text-muted-foreground animate-spin mb-3" />
    {#if message}
      <p class="text-sm text-muted-foreground">{message}</p>
    {/if}
  </div>
{:else}
  <div class="p-8 text-center text-muted-foreground text-sm {className}">
    {message}
  </div>
{/if}
