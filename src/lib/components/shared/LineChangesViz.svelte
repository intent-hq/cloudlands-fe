<script lang="ts">
  /**
   * LineChangesViz - Visual representation of line changes with bars
   * Shows green bar for additions and red bar for deletions
   */
  import { Tooltip } from '$lib/components/ui/tooltip';

  interface Props {
    additions?: number;
    deletions?: number;
    defaultMax?: number;
    height?: number;
    class?: string;
  }

  let {
    additions = 0,
    deletions = 0,
    defaultMax = 75,
    height = 12,
    class: className = '',
  }: Props = $props();

  // Calculate the maximum value for scaling
  const maxValue = $derived(Math.max(defaultMax, additions, deletions));

  // Calculate heights as percentages (0-100)
  const additionsHeight = $derived(
    additions === 0 ? 0 : Math.max(1, Math.round((additions / maxValue) * height))
  );
  const deletionsHeight = $derived(
    deletions === 0 ? 0 : Math.max(1, Math.round((deletions / maxValue) * height))
  );

  const hasChanges = $derived(additions > 0 || deletions > 0);

  // Build tooltip content
  const tooltipContent = $derived(() => {
    const parts: string[] = [
      "Local changes:"
    ];
    if (additions > 0) {
      parts.push(`+${additions.toLocaleString()} addition${additions === 1 ? '' : 's'}`);
    }
    if (deletions > 0) {
      parts.push(`-${deletions.toLocaleString()} deletion${deletions === 1 ? '' : 's'}`);
    }
    return parts.join('\n');
  });
</script>

{#if hasChanges}
  <Tooltip content={tooltipContent()} side="top" class="whitespace-pre-line">
    <div class="flex items-end gap-px subpixel-antialiased {className}" style="height: {height}px;">
      <!-- Green bar for additions -->
      {#if additions > 0}
        <div
          class="w-[3px] rounded-t-xs bg-emerald-500"
          style="height: {additionsHeight}px;"
        ></div>
      {/if}

      <!-- Red bar for deletions -->
      {#if deletions > 0}
        <div
          class="w-[3px] rounded-t-xs bg-red-500"
          style="height: {deletionsHeight}px;"
        ></div>
      {/if}
    </div>
  </Tooltip>
{/if}
