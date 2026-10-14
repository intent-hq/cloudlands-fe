<script lang="ts">
  import { onDestroy } from 'svelte';
  import { FileInput } from '$lib/components/ui/file-input';
  import type { VideoSource } from '$shared/types';
  import ChatVideoBlock from '../ChatVideoBlock.svelte';

  let source = $state<VideoSource>();
  let name = $state('');
  let poster = $state<string>();
  const readers = new Set<FileReader>();

  function read(files: FileList | undefined, isPoster: boolean) {
    const file = files?.[0];
    if (!file) return;
    const reader = new FileReader();
    readers.add(reader);
    reader.onload = () => {
      const url = String(reader.result);
      if (isPoster) poster = url;
      else {
        name = file.name;
        source = { kind: 'inline', mimeType: file.type, data: url.slice(url.indexOf(',') + 1) };
      }
    };
    reader.onloadend = () => readers.delete(reader);
    reader.readAsDataURL(file);
  }

  onDestroy(() => {
    for (const reader of readers) reader.abort();
  });
</script>

<div data-testid="video-files-host">
  <FileInput
    id="local-video"
    label="Choose local video"
    accept="video/*"
    onFilesChange={(files) => read(files, false)}
  />
  <FileInput
    id="local-poster"
    label="Choose local poster"
    accept="image/*"
    onFilesChange={(files) => read(files, true)}
  />
  {#if source}
    <ChatVideoBlock {source} {name} {poster} />
  {/if}
</div>
