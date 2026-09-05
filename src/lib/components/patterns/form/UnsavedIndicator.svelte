<script lang="ts">
  import { cn } from '$lib/utils.js';
  import type { SaveStatus } from './types';

  let {
    status,
    label,
    class: className,
  }: { status: SaveStatus; label?: string; class?: string } = $props();
</script>

{#if status !== 'idle'}
  <span
    data-slot="unsaved-indicator"
    data-state={status}
    role={label ? 'status' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    class={cn(
      'inline-flex size-4 items-center justify-center text-muted-foreground transition-[opacity,transform,color] duration-spring-fast ease-spring-fast motion-reduce:transition-none',
      status === 'saved' && 'text-emerald-500 animate-in fade-in zoom-in-75',
      status === 'error' && 'text-destructive',
      className,
    )}
  >
    {#if status === 'saving'}
      <span class="size-2.5 animate-spin rounded-full border border-current border-t-transparent"
      ></span>
    {:else if status === 'saved'}
      <svg viewBox="0 0 16 16" fill="none" class="size-4" aria-hidden="true">
        <path d="m3 8 3 3 7-7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
      </svg>
    {:else}
      <span class="size-1.5 rounded-full bg-current"></span>
    {/if}
  </span>
{/if}
