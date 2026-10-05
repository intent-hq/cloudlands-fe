<!-- @catalog-exempt: static loading status tile with no interactive DOM -->

<script lang="ts">
  import { faImage } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';

  interface Props {
    /** Path or asset name of the image being loaded. */
    name?: string;
  }

  let { name }: Props = $props();
</script>

<span
  class="flex min-w-0 max-w-full items-center gap-2 px-2.5 py-2 text-muted-foreground"
  role="status"
  data-testid="media-loading-placeholder"
>
  <Fa icon={faImage} class="size-3.5 shrink-0" />
  <span class="type-caption min-w-0 truncate" title={name}>
    {name || m.ui_mediaLoadingPlaceholder_title_label()}
  </span>
</span>
