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
  class="my-1 h-8 w-full justify-start gap-2 px-2 type-caption font-normal text-muted-foreground"
  aria-label={ariaLabel}
  aria-expanded={expanded}
  aria-busy={loading}
  disabled={loading}
  {onclick}
>
  <span class="flex min-w-0 items-center gap-1.5" data-commit-boundary-label>
    <span class="truncate">{label}</span>
    {#if loading}
      <IntentMarkLoader size={12} />
    {:else}
      <DisclosureIcon {expanded} />
    {/if}
  </span>
  <span class="h-px min-w-4 flex-1 bg-border" aria-hidden="true" data-commit-boundary-divider
  ></span>
</Button>
