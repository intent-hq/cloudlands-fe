<script lang="ts">
  /** Test harness: an editable panel that may report its content as loaded. */
  import { getHomePanelContext } from '../home-panel-context';

  let { reportsContent = false }: { reportsContent?: boolean } = $props();
  const homePanel = getHomePanelContext();
  $effect(() => {
    if (reportsContent) homePanel?.markContentLoaded();
  });
</script>

<textarea data-gated-child aria-label="draft">unsaved draft</textarea>
