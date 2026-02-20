<script lang="ts">
  interface Props {
    isDraggingOver: boolean;
  }

  let { isDraggingOver }: Props = $props();
</script>

{#if isDraggingOver}
  <div
    class="absolute inset-0 z-50 bg-primary/10 backdrop-blur-sm flex items-center justify-center pointer-events-none"
  >
    <div class="bg-background border-2 border-dashed border-primary rounded-lg p-8">
      <p class="text-lg font-medium">Drop files here to add to space</p>
    </div>
  </div>
{/if}
