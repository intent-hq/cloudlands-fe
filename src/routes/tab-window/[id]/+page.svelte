<script lang="ts">
  /**
   * Tab window page: one panel tab of a workspace in a window of its own
   * (shared/types/tab-window.ts). The tab window saga reads the record from
   * main and puts the tab in a one-tab layout; this page shows it.
   */
  import TabWindowShell from '$features/tab-window/components/TabWindowShell.svelte';
  import { tabWindowRecord } from '$lib/tab-window/tab-window-state';
</script>

<TabWindowShell record={$tabWindowRecord} />
