<script lang="ts">
  import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    providerId: string;
    providerLabel: string;
    error: string;
    hint?: string;
    compact?: boolean;
  }

  let { providerLabel, error, hint, compact = false }: Props = $props();

  const displayText = $derived(`${providerLabel}: ${error}`);
</script>

<Fa
  icon={faTriangleExclamation}
  class={compact
    ? 'h-3 w-3 text-warning-foreground shrink-0 mt-0.5'
    : 'h-3.5 w-3.5 text-warning-foreground shrink-0 mt-0.5'}
/>
<div class={compact ? 'min-w-0 leading-tight' : 'flex-1 min-w-0'}>
  {#if compact}
    <span class="font-medium text-foreground">{displayText}</span>
    {#if hint}
      <span class="text-subtle"> {hint}</span>
    {/if}
  {:else}
    <div class="type-caption font-medium leading-tight text-foreground">{displayText}</div>
    {#if hint}
      <div class="type-caption mt-0.5 leading-tight text-subtle">{hint}</div>
    {/if}
  {/if}
</div>
