<script lang="ts">
  import type { NodeViewProps } from '@tiptap/core';
  import Fa from 'svelte-fa';
  import { faExpand } from '@fortawesome/free-solid-svg-icons';
  import { NodeViewWrapper } from '$lib/utils/tiptap/svelte-node-view';
  import MediaUnavailable from '$lib/components/ui/MediaUnavailable.svelte';
  import VideoActionsMenu from '$lib/components/ui/VideoActionsMenu.svelte';
  import VideoLightbox from '$lib/components/ui/VideoLightbox.svelte';
  import { parseWorkspaceFileImageUrl } from '$lib/utils/image-actions';
  import { parseIntentFileTarget } from '$lib/utils/workspace-file-image';
  import { m } from '$shared/paraglide/messages.js';

  let { node, selected, editor, extension }: NodeViewProps = $props();

  let videoUrl = $derived<string>(node.attrs.src ?? '');
  let videoName = $derived<string>(node.attrs.name || m.chat_videoBlock_fromAgent_label());
  let lightboxOpen = $state(false);
  let openerElement: HTMLElement | null = $state(null);
  let failedVideoUrl = $state<string | null>(null);
  let configuredWorkspaceId = $derived<string | undefined>(extension.options.workspaceId);
  let workspaceFile = $derived(parseWorkspaceFileImageUrl(videoUrl));
  let intentFile = $derived(parseIntentFileTarget(videoUrl, configuredWorkspaceId));
  let unavailablePath = $derived(workspaceFile?.path ?? intentFile?.path);
  let unavailableWorkspaceId = $derived(
    workspaceFile?.workspaceId ?? intentFile?.workspaceId ?? configuredWorkspaceId,
  );

  function openLightbox(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    openerElement =
      event.currentTarget instanceof HTMLElement ? event.currentTarget : editor.view.dom;
    lightboxOpen = true;
  }
</script>

<NodeViewWrapper class={`note-video-node${selected ? ' selected' : ''}`}>
  <div class="group relative inline-block max-w-full">
    {#if failedVideoUrl === videoUrl}
      <MediaUnavailable
        name={videoName}
        reason={workspaceFile ? 'missing' : 'load-failed'}
        path={unavailablePath}
        workspaceId={unavailableWorkspaceId}
      />
    {:else}
      <!-- svelte-ignore a11y_media_has_caption (workspace video has no captions field) -->
      <video
        src={videoUrl}
        controls
        preload="metadata"
        playsinline
        class="markdown-video max-w-full rounded-md"
        aria-label={videoName}
        onerror={() => (failedVideoUrl = videoUrl)}
        draggable="true"
      ></video>
      <div
        class="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        contenteditable="false"
      >
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-ring"
          onclick={openLightbox}
          aria-label={m.chat_videoBlock_play_ariaLabel({ name: videoName })}
        >
          <Fa icon={faExpand} size="sm" />
        </button>
        <VideoActionsMenu {videoUrl} {videoName} sourceKind="workspace" />
      </div>
    {/if}
  </div>
</NodeViewWrapper>

<VideoLightbox
  bind:open={lightboxOpen}
  {videoUrl}
  {videoName}
  sourceKind="workspace"
  {openerElement}
/>

<style>
  :global(.note-video-node) {
    display: block;
  }

  :global(.note-video-node.selected video) {
    outline: 2px solid hsl(var(--ring));
    outline-offset: 2px;
  }
</style>
