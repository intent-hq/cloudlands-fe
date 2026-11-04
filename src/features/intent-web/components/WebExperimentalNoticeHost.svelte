<script lang="ts">
  /**
   * Mounts the experimental notice at each start of the web build served by a
   * Browser access host (intent-web or the desktop's Browser access). Never
   * in Electron or without a host runtime config: the host record is only
   * seeded from a valid page host outside Electron.
   */
  import { store } from '$store/renderer/store';
  import { selectShowsWebExperimentalNotice } from '$store/renderer/slices/global-modals/global-modals-selectors';
  import { webExperimentalNoticeDismissed } from '$store/renderer/slices/global-modals/global-modals-slice';
  import { selectHostManagesConnections } from '$store/renderer/slices/connections/connections-selectors';
  import WebExperimentalNotice from './WebExperimentalNotice.svelte';

  const shows$ = selectShowsWebExperimentalNotice();
  const hostManagesConnections$ = selectHostManagesConnections();
</script>

{#if $shows$}
  <WebExperimentalNotice
    hostManagesConnections={$hostManagesConnections$}
    onDismiss={() => store.dispatch(webExperimentalNoticeDismissed())}
  />
{/if}
