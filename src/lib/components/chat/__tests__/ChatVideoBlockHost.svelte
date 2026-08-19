<script lang="ts">
  import ChatVideoBlock from '../ChatVideoBlock.svelte';

  let {
    theme = 'light',
    width = 640,
    zoom = 1,
  }: { theme?: 'light' | 'dark'; width?: number; zoom?: number } = $props();
</script>

<div class={theme} style:width="{width}px" style:zoom data-testid="video-host">
  <div class="h-56 overflow-y-auto bg-background p-2" data-testid="transcript-scroll">
    <div class="h-48" aria-hidden="true"></div>
    <ChatVideoBlock
      source={{ kind: 'remote', url: 'https://media.example/demo.mp4', mimeType: 'video/mp4' }}
      name="demo.mp4"
    />
    <div class="h-48" aria-hidden="true"></div>
  </div>
</div>
