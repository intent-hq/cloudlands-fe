<script lang="ts">
  /**
   * Note shown next to tunnel fields when the page host (intent-web) cannot
   * dial tailcat tunnel routes. Direct host and port routes still work.
   */
  import { m } from '$shared/paraglide/messages.js';
  import { selectHostTailcatUnavailable } from '$store/renderer/slices/connections/connections-selectors';

  let { relevant = true }: { relevant?: boolean } = $props();
  const unavailable$ = selectHostTailcatUnavailable();
</script>

{#if relevant && $unavailable$}
  <p role="note" class="type-caption text-muted-foreground">
    {m.settings_devices_tailcatUnavailable_note()}
  </p>
{/if}
