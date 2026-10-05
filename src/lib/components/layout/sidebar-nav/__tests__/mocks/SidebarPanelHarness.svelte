<script lang="ts">
  import { store as appStore } from '$store/renderer/store';
  import { guestSessionsListUnavailable } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { admitLegacyPrincipal } from '../../../../../../test/fixtures/principal-state';
  import SidebarPanel from '../../SidebarPanel.svelte';

  interface Props {
    setup?: () => void;
  }

  let { setup }: Props = $props();

  appStore.init();
  // Settle the window identity as an owner window (no guest list outside
  // Electron); until it settles the panel reads as collaborator-only and
  // withholds the Chief (multiplayer w3/w4).
  appStore.dispatch(guestSessionsListUnavailable());
  admitLegacyPrincipal();
  $effect.pre(() => setup?.());
</script>

<SidebarPanel />
