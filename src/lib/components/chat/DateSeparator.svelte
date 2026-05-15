<script lang="ts">
  import Fa from 'svelte-fa';
  import { faCalendar } from '@fortawesome/free-solid-svg-icons';

interface Props {
    label: string;
    showIcon?: boolean;
  }

  let { label, showIcon = true }: Props = $props();
</script>

<div class="flex items-center gap-3 my-6 px-6 font-family-child">
  <div class="flex-1 h-px bg-border/50"></div>
  <div class="flex items-center gap-2 px-3 py-1 bg-muted/50 rounded-full border border-border/50">
    {#if showIcon}
      <Fa icon={faCalendar} size="xs" class="text-ghost" />
    {/if}
    <span class="text-xs font-medium text-muted-foreground first-letter:uppercase">{label}</span>
  </div>
  <div class="flex-1 h-px bg-border/50"></div>
</div>
