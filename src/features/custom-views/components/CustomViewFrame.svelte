<script lang="ts">
  import { onMount } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { selectCustomViewsState } from '../custom-views-selectors';
  import {
    customViewFrameOpened,
    customViewFrameClosed,
    customViewFrameStatus,
  } from '../custom-views-slice';
  import { m } from '$shared/paraglide/messages.js';
  import { attachCustomViewThemeBridge } from '../custom-view-theme-bridge';

  let { viewId, url, title }: { viewId: string; url: string; title: string } = $props();
  const state$ = selectCustomViewsState();
  function themeBridge(iframe: HTMLIFrameElement, frameUrl: string) {
    let dispose = attachCustomViewThemeBridge(iframe, frameUrl);
    return {
      update(nextUrl: string) {
        dispose();
        dispose = attachCustomViewThemeBridge(iframe, nextUrl);
      },
      destroy() {
        dispose();
      },
    };
  }
  onMount(() => {
    appStore.dispatch(customViewFrameOpened(viewId));
    return () => {
      appStore.dispatch(customViewFrameClosed(viewId));
    };
  });
</script>

{#if $state$.frame.status === 'slow' || $state$.frame.status === 'error'}
  <p role="alert" class="shrink-0 px-4 py-2 type-caption text-muted-foreground">
    {m.custom_views_frame_timeout()}
  </p>
{/if}
{#key $state$.frame.revision}
  {@const revision = $state$.frame.revision}
  <iframe
    src={url}
    use:themeBridge={url}
    {title}
    class="min-h-0 w-full flex-1 border-0 bg-background"
    sandbox="allow-scripts allow-forms allow-same-origin"
    referrerpolicy="no-referrer"
    onload={() => appStore.dispatch(customViewFrameStatus(viewId, revision, 'loaded'))}
    onerror={() => appStore.dispatch(customViewFrameStatus(viewId, revision, 'error'))}
  ></iframe>
{/key}
