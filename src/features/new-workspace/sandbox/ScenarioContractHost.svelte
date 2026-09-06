<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { UntitledWorkspaceShell } from '../ui';
  import { reduce, type Capability, type DraftInput } from '../controller';
  import { getScenario } from './scenarios';
  import { store as appStore } from '$store/renderer/store';
  import {
    beginWorkspaceCreateProgress,
    workspaceCreateProgressReceived,
  } from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
  import { applySetupScenarioDom, installSetupScenarioFixtures } from './setup-fixtures';

  interface Props {
    scenarioId: string;
  }

  let { scenarioId }: Props = $props();
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown new-workspace scenario: ${scenarioId}`);
  // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous sandbox-only mock wiring
  const disposeFixtures = installSetupScenarioFixtures(scenario.fixtures);
  onDestroy(disposeFixtures);

  const cloneProgress = scenario.presentation?.progress?.clone;
  const progressId = scenario.initialControllerState.draft?.operationKey;
  if (cloneProgress && progressId && cloneProgress.percent !== undefined) {
    appStore.dispatch(beginWorkspaceCreateProgress(progressId));
    appStore.dispatch(
      workspaceCreateProgressReceived(progressId, {
        phase: cloneProgress.phase,
        percent: cloneProgress.percent,
      }),
    );
  }

  let controllerState = $state(scenario.initialControllerState);

  function edit(patch: Partial<DraftInput>): void {
    controllerState = reduce(controllerState, { type: 'user.edited', patch });
  }

  function refresh(): void {
    controllerState = reduce(controllerState, {
      type: 'capability.result',
      capability: 'github',
      status: controllerState.capabilities.github,
      generation: controllerState.generation,
    });
  }

  function providerSelected(): void {
    controllerState = reduce(controllerState, {
      type: 'capability.result',
      capability: 'provider',
      status: 'ready',
      generation: controllerState.generation,
    });
  }

  function start(requiredCapabilities: Capability[]): void {
    controllerState = reduce(controllerState, { type: 'start.requested', requiredCapabilities });
  }

  onMount(() => {
    void tick().then(() => {
      const root = document.querySelector(`[data-scenario-id="${scenario.id}"]`);
      // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous sandbox-only DOM state
      if (root) applySetupScenarioDom(root, scenario.fixtures);
    });
    window.addEventListener('new-workspace-scenario-refresh', refresh);
    return () => window.removeEventListener('new-workspace-scenario-refresh', refresh);
  });
</script>

<div
  data-scenario-id={scenario.id}
  data-source-kind={controllerState.input.source?.kind ?? ''}
  data-source-name={controllerState.input.source?.kind === 'newFolder'
    ? controllerState.input.source.name
    : ''}
  data-capture-stable="true"
>
  <UntitledWorkspaceShell
    state={controllerState}
    presentation={scenario.presentation}
    onEdit={edit}
    onStart={start}
    onRetry={() => (controllerState = reduce(controllerState, { type: 'retry' }))}
    onReconnect={() => (controllerState = reduce(controllerState, { type: 'reconnect' }))}
    onAcceptRemote={() =>
      (controllerState = reduce(controllerState, { type: 'conflict.acceptRemote' }))}
    onKeepLocal={() => (controllerState = reduce(controllerState, { type: 'conflict.keepLocal' }))}
    onSourceSelected={(source) => edit({ source })}
    onChooseNewFolder={(name) =>
      edit({ source: { kind: 'newFolder', parentPath: '/sandbox/projects', name } })}
    onRecheckCapabilities={refresh}
    onProviderSelected={providerSelected}
  />
</div>
