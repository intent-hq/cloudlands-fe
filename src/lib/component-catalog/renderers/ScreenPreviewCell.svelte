<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    id,
    label,
    width = 'full',
    zoom = false,
    children,
  }: {
    id: string;
    label: string;
    width?: 'full' | '320';
    zoom?: boolean;
    children: Snippet;
  } = $props();
</script>

<article class="preview-cell" data-screen-preview={id} aria-labelledby={`${id}-label`}>
  <h4 id={`${id}-label`} class="preview-label">{label}</h4>
  <div
    class="preview-frame"
    class:narrow={width === '320'}
    class:zoom-preview={zoom}
    data-preview-width={width}
  >
    {@render children()}
  </div>
</article>

<style>
  .preview-cell {
    display: grid;
    min-width: 0;
    align-content: start;
    gap: var(--space-2);
  }
  .preview-label {
    font-size: var(--text-caption-size);
    font-weight: var(--text-body-strong-weight);
    color: hsl(var(--muted-foreground));
  }
  .preview-frame {
    width: 100%;
    min-width: 0;
    overflow: hidden;
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-large);
    background: hsl(var(--background));
  }
  .preview-frame.narrow {
    width: min(100%, 20rem);
  }
  .preview-frame.zoom-preview {
    width: 50%;
    zoom: 2;
  }
</style>
