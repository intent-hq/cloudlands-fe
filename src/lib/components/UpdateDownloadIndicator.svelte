<script lang="ts">
  /**
   * UpdateDownloadIndicator - Small spinning indicator shown during update download
   *
   * Displays a small spinning icon with tooltip when an update is being downloaded.
   * Positioned next to SpacesPicker when in a workspace, or top-right when on home.
   */

  import { Tooltip } from '$lib/components/ui/tooltip';
  import { cn } from '$lib/utils';
  import { faArrowsRotate } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import {
    selectIsDownloading,
    selectAutoUpdateProgress,
  } from '$lib/store/slices/auto-update/auto-update-selectors';

  interface Props {
    class?: string;
  }

  let { class: className }: Props = $props();

  const isDownloading$ = selectIsDownloading();
  const progress$ = selectAutoUpdateProgress();

  // Show when downloading
  let isDownloading = $derived($isDownloading$);
  let progress = $derived($progress$);
  let progressPercent = $derived(progress ? Math.round(progress.percent) : 0);
</script>

{#if isDownloading}
  <Tooltip content="Downloading update... {progressPercent}%" side="bottom" delayDuration={100}>
    <div
      class={cn(
        'flex items-center justify-center w-6 h-6 rounded-md',
        'text-subtle',
        className,
      )}
    >
      <Fa icon={faArrowsRotate} class="w-3 h-3 animate-spin" />
    </div>
  </Tooltip>
{/if}
