<script lang="ts">
  import {
  createReactiveRelativeTime,
  createReactiveCompactTime,
} from '$lib/utils/reactive-time.svelte';
  import { formatFullDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { onDestroy } from 'svelte';

  interface Props {
    date: Date | string | number;
    compact?: boolean;
    class?: string;
    title?: string;
  }

  let { date, compact = false, class: className = '', title }: Props = $props();

  // Track the current timeObj for cleanup
  let currentTimeObj: ReturnType<typeof createReactiveRelativeTime> | null = null;

  // Create the reactive time object based on compact mode
  // Use $derived.by to react to changes in compact and date props
  let timeObj = $derived.by(() => {
    // Cleanup previous timeObj if it exists
    if (currentTimeObj) {
      currentTimeObj.cleanup();
    }
    const newTimeObj = compact ? createReactiveCompactTime(date) : createReactiveRelativeTime(date);
    currentTimeObj = newTimeObj;
    return newTimeObj;
  });

  // Get the reactive time value
  let relativeTime = $derived(timeObj.time);

  // Clean up on destroy
  onDestroy(() => {
    if (currentTimeObj) {
      currentTimeObj.cleanup();
    }
  });

  // Generate a full timestamp for the title/tooltip if not provided
  let fullTimestamp = $derived.by(() => {
    if (title) return title;

    const d = new Date(date);
    if (isNaN(d.getTime())) return m.ui_relativeTime_invalid_label();

    return formatFullDateTime(d);
  });
</script>

<span class={className} title={fullTimestamp}>
  {relativeTime}
</span>
