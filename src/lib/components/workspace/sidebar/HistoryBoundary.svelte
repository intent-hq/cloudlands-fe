<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import DisclosureIcon from '$lib/components/icons/DisclosureIcon.svelte';

  let {
    label,
    expanded,
    loading = false,
    onclick,
    ariaLabel = label,
    ...rest
  }: {
    label: string;
    expanded: boolean;
    loading?: boolean;
    onclick: () => void;
    ariaLabel?: string;
    [attribute: `data-${string}`]: string | undefined;
  } = $props();
</script>

<Button
  {...rest}
  variant="ghost"
  size="compact"
  wrapContent={false}
  class="h-7 w-full justify-start gap-1 px-2 type-caption font-normal text-muted-foreground"
  aria-label={ariaLabel}
  aria-expanded={expanded}
  aria-busy={loading}
  disabled={loading}
  {onclick}
>
  <span
    class="flex size-(--control-height-compact) shrink-0 items-center justify-center"
    aria-hidden="true"
  >
    {#if loading}
      <IntentMarkLoader size={12} />
    {:else}
      <DisclosureIcon {expanded} />
    {/if}
  </span>
  <span class="min-w-0 truncate" data-commit-boundary-label>{label}</span>
  <span class="h-px min-w-4 flex-1 bg-border" aria-hidden="true" data-commit-boundary-divider
  ></span>
</Button>
