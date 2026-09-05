<script lang="ts">
  import { onMount } from 'svelte';
  import { UntitledWorkspaceShell } from '../ui';
  import { reduce, type Capability, type DraftInput } from '../controller';
  import { getScenario } from './scenarios';

  interface Props {
    scenarioId: string;
  }

  let { scenarioId }: Props = $props();
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown new-workspace scenario: ${scenarioId}`);

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
    window.addEventListener('new-workspace-scenario-refresh', refresh);
    return () => window.removeEventListener('new-workspace-scenario-refresh', refresh);
  });
</script>

<div data-scenario-id={scenario.id} data-capture-stable="true">
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
    onChooseLocal={() => undefined}
    onChooseGitHub={() => undefined}
    onChooseNewFolder={(name) =>
      edit({ source: { kind: 'newFolder', parentPath: '/sandbox/projects', name } })}
    onRecheckCapabilities={refresh}
    onProviderSelected={providerSelected}
  />
</div>
