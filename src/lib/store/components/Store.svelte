<script lang="ts">
  import { onDestroy, setContext, type Snippet } from "svelte";
  import { init } from "../init";
  import { type PreloadedStoreState } from "../types";
  import RunSaga from "./RunSaga.svelte";
  import { STORE_CONTEXT } from "../constants";
  import { getStoreContext } from "../utils/utils";

  const {
    initialState,
    children,
  }: {
    initialState?: PreloadedStoreState;
    children: Snippet;
  } = $props();

  let storeContext = null;
  const existingStoreContext = getStoreContext();

  if (!existingStoreContext) {
    storeContext = init(initialState);
    setContext(STORE_CONTEXT, storeContext);
  }

  onDestroy(() => {
    storeContext?.dispose();
  });
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
<RunSaga sagaName="fontSettingsSaga" />
<RunSaga sagaName="uiLayoutSaga" />
<RunSaga sagaName="externalEditorsSaga" />
<RunSaga sagaName="tabStateSaga" />
<RunSaga sagaName="terminalOverlaySaga" />
<RunSaga sagaName="noteReadTrackingSaga" />
<RunSaga sagaName="notificationSettingsSaga" />
<RunSaga sagaName="workspaceSettingsSaga" />
<RunSaga sagaName="permissionSaga" />
<RunSaga sagaName="featureCodesSaga" />
<RunSaga sagaName="modelSaga" />
<RunSaga sagaName="specialistsSaga" />
<RunSaga sagaName="pipSaga" />
<RunSaga sagaName="userPreferencesSaga" />
{@render children?.()}
