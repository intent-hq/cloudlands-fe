<script lang="ts" module>
  import { setContext } from 'svelte';
  import { init } from '../init';
  import { type PreloadedStoreState } from '../types';
  import { STORE_CONTEXT } from '../constants';
  import { getStoreContext } from '../utils/utils';

  export function initStore(initialState?: PreloadedStoreState): () => void {
    const existingStoreContext = getStoreContext();
    if (existingStoreContext) {
      return () => {};
    }

    const storeContext = init(initialState);
    setContext(STORE_CONTEXT, storeContext);
    return () => {
      storeContext.dispose();
    };
  }
</script>

<script lang="ts">
  import { onDestroy, type Snippet } from 'svelte';
  import RunSaga from './RunSaga.svelte';

  const {
    initialState,
    children,
  }: {
    initialState?: PreloadedStoreState;
    children: Snippet;
  } = $props();

  const dispose = initStore(initialState);

  onDestroy(dispose);
</script>

<RunSaga sagaName="streamingSaga" />
<RunSaga sagaName="workspaceSaga" />
<RunSaga sagaName="gitSaga" />
<RunSaga sagaName="fileTrackingSaga" />
<RunSaga sagaName="notesSaga" />
<RunSaga sagaName="agentsSaga" />
<RunSaga sagaName="messagesSaga" />
<RunSaga sagaName="contextSaga" />
<RunSaga sagaName="browserSaga" />
<RunSaga sagaName="mcpSaga" />
<RunSaga sagaName="diffsSaga" />
<RunSaga sagaName="settingsSaga" />
<RunSaga sagaName="authSaga" />
<RunSaga sagaName="uiSaga" />
<RunSaga sagaName="layoutSaga" />
<RunSaga sagaName="terminalsSaga" />
<RunSaga sagaName="autoUpdateSaga" />
<RunSaga sagaName="workspaceInitializerSaga" />
<RunSaga sagaName="providerSettingsSaga" />
<RunSaga sagaName="backgroundAgentSettingsSaga" />
<RunSaga sagaName="uiLayoutSaga" />
<RunSaga sagaName="externalEditorsSaga" />
<RunSaga sagaName="tabStateSaga" />
<RunSaga sagaName="noteReadTrackingSaga" />
<RunSaga sagaName="workspaceOperationsSaga" />
<RunSaga sagaName="workspaceSettingsSaga" />
<RunSaga sagaName="permissionSaga" />
<RunSaga sagaName="featureCodesSaga" />
<RunSaga sagaName="knownReposSaga" />
<RunSaga sagaName="modelSaga" />
<RunSaga sagaName="specialistsSaga" />
<RunSaga sagaName="pipSaga" />
<RunSaga sagaName="systemStatusSaga" />
<RunSaga sagaName="userPreferencesSaga" />
{@render children?.()}
