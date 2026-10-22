<script lang="ts">
  import { onDestroy } from 'svelte';
  import { store as appStore } from '$store/renderer/store';
  import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';
  import { setLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import { workspaceInitializerGitSaga } from '$store/renderer/slices/workspace-initializer/sagas/workspace-initializer-git-saga';
  import { selectWorkspaceInitializerGitAvailability } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
  import {
    admitLegacyPrincipal,
    withHostPrincipal,
  } from '../../../../test/fixtures/principal-state';
  import '$store/renderer/seeders/host-bridge-seeder';
  import NewSpaceModal from '../NewSpaceModal.svelte';

  appStore.dispatch(
    connectionsListReceived({
      connections: [],
      activeId: 'local',
      windowBackendId: 'shared-host-fixture',
    }),
  );
  admitLegacyPrincipal();
  appStore.dispatch(setLabsMultiplayerEnabled(true));
  const { principal } = withHostPrincipal(appStore.state, 'member');
  appStore.dispatch(principalContextChanged(principal.context));
  appStore.dispatch(
    principalReceived(
      { context: principal.context!, invalidation: 0, presentationVersion: 0 },
      principal.snapshot!,
    ),
  );
  onDestroy(appStore.runSaga(workspaceInitializerGitSaga));
  const available$ = selectWorkspaceInitializerGitAvailability();
</script>

<NewSpaceModal open />
<output class="sr-only" data-git-probe-result>{String($available$)}</output>
