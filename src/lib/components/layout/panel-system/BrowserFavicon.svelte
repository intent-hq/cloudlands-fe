<script lang="ts">
  import { faGlobe } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';

  interface Props {
    faviconUrl?: string;
    size?: number;
    fallbackClass?: string;
  }

  let { faviconUrl, size = 16, fallbackClass = 'text-muted-foreground' }: Props = $props();

  function handleLoad(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) {
      event.currentTarget.style.opacity = '1';
    }
  }

  function handleError(event: Event) {
    if (event.currentTarget instanceof HTMLImageElement) {
      event.currentTarget.style.opacity = '0';
    }
  }
</script>

<span
  class="relative inline-flex shrink-0 items-center justify-center"
  style="width: {size}px; height: {size}px;"
  aria-hidden="true"
>
  <Fa icon={faGlobe} {size} class={fallbackClass} />
  {#key faviconUrl}
    {#if faviconUrl}
      <img
        src={faviconUrl}
        alt=""
        width={size}
        height={size}
        class="absolute inset-0 size-full rounded-sm object-contain opacity-0"
        onload={handleLoad}
        onerror={handleError}
      />
    {/if}
  {/key}
</span>
