<script lang="ts">
  import Fa from 'svelte-fa';
  import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';

  interface Props {
    icon: IconDefinition;
    title: string;
    summary?: string;
  }

  let { icon, title, summary }: Props = $props();
</script>

<header class="flex min-w-0 items-start gap-3" data-proposal-card-header>
  <span
    class="flex size-10 shrink-0 items-center justify-center rounded-(--radius-large) border border-primary/20 bg-primary/10 text-primary"
    aria-hidden="true"
    data-proposal-header-icon
  >
    <Fa {icon} class="size-4" />
  </span>
  <div class="min-w-0 flex-1 pt-0.5">
    <h3 class="type-title font-semibold text-foreground">{title}</h3>
    {#if summary}
      <p class="type-body mt-1 leading-relaxed text-muted-foreground">{summary}</p>
    {/if}
  </div>
</header>
