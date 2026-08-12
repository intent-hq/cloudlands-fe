<script lang="ts">
  import { ScrollArea } from './index';
</script>

<ScrollArea
  orientation="both"
  class="h-32 w-64 rounded-md border border-border"
  data-testid="overflow-area"
>
  <div class="w-max space-y-2 p-3" data-testid="long-scroll-content">
    {#each Array.from({ length: 16 }) as _, index (index)}
      <p>Scrollable documentation row {index + 1} with deliberately long horizontal content</p>
    {/each}
  </div>
</ScrollArea>

<ScrollArea orientation="vertical" class="h-32 w-64" data-testid="no-overflow-area">
  <p>Short content</p>
</ScrollArea>
