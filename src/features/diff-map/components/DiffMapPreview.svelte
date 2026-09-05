<script lang="ts">
  import type { ComponentProps } from 'svelte';
  import DiffMap from './DiffMap.svelte';

  let props: ComponentProps<typeof DiffMap> = $props();
</script>

<div class="preview-container">
  <div class="preview-frame">
    <DiffMap {...props} />
  </div>
</div>

<style>
  .preview-container {
    width: 100%;
    container-type: inline-size;
  }

  .preview-frame {
    height: 500px;
  }

  @container (max-width: 479px) {
    .preview-frame {
      height: 600px;
    }
  }
</style>
