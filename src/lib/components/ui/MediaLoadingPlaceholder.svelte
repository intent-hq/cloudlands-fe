<!-- @catalog-exempt: inline loading status with no interactive DOM -->

<script lang="ts">
  import { faImage } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import { truncatedTitle } from '$lib/actions/observe-overflow';

  interface Props {
    /** Path or asset name of the image being loaded. */
    name?: string;
  }

  let { name }: Props = $props();
</script>

<span
  class="type-caption flex min-w-0 max-w-full items-start gap-2 whitespace-normal py-1 text-muted-foreground"
  role="status"
  data-testid="media-loading-placeholder"
>
  <span class="first-line-icon" aria-hidden="true">
    <Fa icon={faImage} class="size-3.5" />
  </span>
  <span class="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
    <span>{m.ui_mediaLoadingPlaceholder_title_label()}</span>
    {#if name}
      <span class="min-w-0 max-w-full truncate" use:truncatedTitle={name}>{name}</span>
    {/if}
  </span>
</span>
