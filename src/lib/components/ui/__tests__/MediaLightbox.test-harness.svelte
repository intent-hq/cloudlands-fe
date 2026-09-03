<script lang="ts">
  import { untrack } from 'svelte';
  import MediaLightbox from '../MediaLightbox.svelte';

  interface Props {
    initialOpen?: boolean;
  }

  let { initialOpen = false }: Props = $props();
  let open = $state(untrack(() => initialOpen));
  let trigger: HTMLButtonElement | null = $state(null);
</script>

<button bind:this={trigger} onclick={() => (open = true)}>Open media</button>
<MediaLightbox bind:open ariaLabel="Media preview" closeLabel="Close media" openerElement={trigger}>
  <div data-media-lightbox-content>Media content</div>
</MediaLightbox>
