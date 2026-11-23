<script lang="ts">
  import AttachmentPreview from '$lib/components/chat/AttachmentPreview.svelte';
  import { IntentMarkLoader } from '$lib/components/ui/indicators';
  import { discussionImageMimeType, type DiscussionImage } from '../discussion-images';

  let {
    images,
    uploads,
    disabled = false,
    onRemove,
  }: {
    images: readonly DiscussionImage[];
    uploads: readonly { id: string; file: File }[];
    disabled?: boolean;
    onRemove: (url: string) => void;
  } = $props();
</script>

{#if images.length || uploads.length}
  <div class="mb-2 flex flex-wrap gap-2" data-discussion-composer-images>
    {#each images as image (image.url)}
      <AttachmentPreview
        id={image.url}
        name={image.name}
        type={discussionImageMimeType(image.url)}
        imageUrl={image.url}
        variant="thumbnail"
        thumbnailClass="size-14"
        {disabled}
        onRemove={disabled ? undefined : onRemove}
      />
    {/each}
    {#each uploads as upload (upload.id)}
      <div class="relative" aria-busy="true">
        <AttachmentPreview
          id={upload.id}
          name={upload.file.name}
          type={upload.file.type}
          file={upload.file}
          variant="thumbnail"
          thumbnailClass="size-14 opacity-50"
          disabled
        />
        <IntentMarkLoader size={16} class="absolute inset-0 m-auto" />
      </div>
    {/each}
  </div>
{/if}
