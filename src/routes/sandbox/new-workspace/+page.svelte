<script lang="ts">
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import {
    NEW_WORKSPACE_SCENARIOS,
    getScenario,
    validateScenarioRegistry,
  } from '$features/new-workspace/sandbox/scenarios';
  import {
    createMockTransactionHarness,
    type MockCallLogEntry,
    type MockTransactionHarness,
  } from '$features/new-workspace/sandbox/mock-transaction';
  import {
    CONTROLLER_PHASES,
    reduce,
    type Capability,
    type ControllerState,
    type DraftInput,
  } from '$features/new-workspace/controller';
  import { UntitledWorkspaceShell } from '$features/new-workspace/ui';
  import { m } from '$shared/paraglide/messages.js';
  import {
    applySetupScenarioDom,
    installSetupScenarioFixtures,
  } from '$features/new-workspace/sandbox/setup-fixtures';

  let resetGeneration = $state(0);
  let harness = $state<MockTransactionHarness>();
  let callLog = $state<readonly MockCallLogEntry[]>([]);
  let pendingOperationIds = $state<readonly number[]>([]);
  let invariantFailures = $state<readonly string[]>([]);
  let controllerState = $state<ControllerState>();

  const scenarioId = $derived(page.url.searchParams.get('scenario'));
  const selectedScenario = $derived(getScenario(scenarioId));
  const width = $derived.by(() => {
    const requested = Number(page.url.searchParams.get('width') ?? 960);
    return Number.isFinite(requested) ? Math.min(1600, Math.max(240, Math.round(requested))) : 960;
  });
  const controllerCoverage = $derived(
    Math.round(
      (new Set(NEW_WORKSPACE_SCENARIOS.map((scenario) => scenario.initialControllerState.phase))
        .size /
        CONTROLLER_PHASES.length) *
        100,
    ),
  );

  function scenarioUrl(id: string): string {
    return `/sandbox/new-workspace?scenario=${encodeURIComponent(id)}&width=${width}`;
  }

  function refreshDeveloperFrame(): void {
    callLog = harness ? [...harness.callLog] : [];
    pendingOperationIds = harness ? harness.pendingOperationIds : [];
    invariantFailures = harness
      ? [...validateScenarioRegistry(NEW_WORKSPACE_SCENARIOS), ...harness.invariantFailures]
      : [];
  }

  function reset(): void {
    resetGeneration += 1;
  }

  function advance(): void {
    harness?.advance();
    refreshDeveloperFrame();
  }

  function reject(): void {
    harness?.reject();
    refreshDeveloperFrame();
  }

  function reconnect(): void {
    harness?.reconnect();
    refreshDeveloperFrame();
  }

  function loseAck(): void {
    harness?.loseAck();
    refreshDeveloperFrame();
  }

  function editDraft(patch: Partial<DraftInput>): void {
    if (controllerState) controllerState = reduce(controllerState, { type: 'user.edited', patch });
  }

  function startDraft(requiredCapabilities: Capability[]): void {
    if (controllerState) {
      controllerState = reduce(controllerState, { type: 'start.requested', requiredCapabilities });
    }
  }

  function chooseNewFolder(name: string): void {
    // i18n-ignore (deterministic sandbox fixture path)
    editDraft({ source: { kind: 'newFolder', parentPath: '/sandbox/projects', name } });
  }

  function chooseProvider(): void {
    if (!controllerState) return;
    controllerState = reduce(controllerState, {
      type: 'capability.result',
      capability: 'provider',
      status: 'ready',
      generation: controllerState.generation,
    });
  }

  function dispatchSimpleEvent(
    type: 'reconnect' | 'conflict.acceptRemote' | 'conflict.keepLocal' | 'retry',
  ): void {
    if (controllerState) controllerState = reduce(controllerState, { type });
  }

  $effect(() => {
    resetGeneration;
    const scenario = selectedScenario;
    if (!scenario) {
      harness = undefined;
      controllerState = undefined;
      refreshDeveloperFrame();
      return;
    }
    controllerState = scenario.initialControllerState;
    // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous sandbox-only mock wiring
    const disposeFixtures = installSetupScenarioFixtures(scenario.fixtures);
    const nextHarness = createMockTransactionHarness(scenario.fixtures);
    harness = nextHarness;
    void nextHarness.runScript(scenario.script).finally(refreshDeveloperFrame);
    queueMicrotask(refreshDeveloperFrame);
    void tick().then(() => {
      const root = document.querySelector(`[data-sandbox-scenario="${scenario.id}"]`);
      // eslint-disable-next-line intent/no-component-async-data-fetch -- synchronous sandbox-only DOM state
      if (root) applySetupScenarioDom(root, scenario.fixtures);
    });
    return () => {
      disposeFixtures();
      nextHarness.dispose();
    };
  });
</script>

<svelte:head>
  <title>{m.sandbox_newWorkspace_page_title()}</title>
</svelte:head>

<section class="mx-auto grid max-w-7xl gap-6 p-4 sm:p-6 lg:p-10">
  <header class="space-y-2">
    <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {m.sandbox_newWorkspace_eyebrow_label()}
    </p>
    <h1 class="text-3xl font-semibold tracking-tight">{m.sandbox_newWorkspace_title()}</h1>
    <p class="max-w-3xl text-sm text-muted-foreground">
      {m.sandbox_newWorkspace_description()}
    </p>
  </header>

  {#if selectedScenario}
    <div class="flex flex-wrap items-center justify-between gap-3">
      <a
        class="text-sm font-medium text-primary underline"
        href={`/sandbox/new-workspace?width=${width}`}
      >
        {m.sandbox_newWorkspace_allScenarios_label()}
      </a>
      <div class="flex flex-wrap gap-2" aria-label={m.sandbox_newWorkspace_controls_ariaLabel()}>
        <button class="control" type="button" onclick={reset}>
          {m.sandbox_newWorkspace_reset_label()}
        </button>
        <button
          class="control"
          type="button"
          disabled={pendingOperationIds.length === 0}
          onclick={advance}
        >
          {m.sandbox_newWorkspace_advance_label()}
        </button>
        <button
          class="control"
          type="button"
          disabled={pendingOperationIds.length === 0}
          onclick={reject}
        >
          {m.sandbox_newWorkspace_reject_label()}
        </button>
        <button class="control" type="button" onclick={reconnect}>
          {m.sandbox_newWorkspace_reconnect_label()}
        </button>
        <button
          class="control"
          type="button"
          disabled={pendingOperationIds.length === 0}
          onclick={loseAck}
        >
          {m.sandbox_newWorkspace_loseAck_label()}
        </button>
      </div>
    </div>

    <div class="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <article
        class="overflow-auto rounded-xl border border-border bg-background p-4"
        data-sandbox-scenario={selectedScenario.id}
        data-expected-phase={selectedScenario.expectedPhase}
      >
        <div class="mx-auto h-[45rem] max-w-full" style:width={`${width}px`}>
          {#if controllerState}
            <UntitledWorkspaceShell
              state={controllerState}
              presentation={selectedScenario.presentation}
              onEdit={editDraft}
              onStart={startDraft}
              onRetry={() => dispatchSimpleEvent('retry')}
              onReconnect={() => dispatchSimpleEvent('reconnect')}
              onAcceptRemote={() => dispatchSimpleEvent('conflict.acceptRemote')}
              onKeepLocal={() => dispatchSimpleEvent('conflict.keepLocal')}
              onChooseNewFolder={chooseNewFolder}
              onSourceSelected={(source) => editDraft({ source })}
              onProviderSelected={chooseProvider}
            />
          {/if}
        </div>
      </article>

      <aside
        class="grid gap-4 rounded-xl border border-border bg-card p-4"
        data-testid="developer-frame"
      >
        <section class="space-y-2">
          <h2 class="text-sm font-semibold">{m.sandbox_newWorkspace_callLog_title()}</h2>
          {#if callLog.length === 0}
            <p class="text-xs text-muted-foreground">{m.sandbox_newWorkspace_none_label()}</p>
          {:else}
            <ol class="grid gap-2">
              {#each callLog as entry (entry.id)}
                <li class="rounded-md bg-muted p-2 text-xs">
                  <div class="flex justify-between gap-2">
                    <code class="break-all">{entry.channel}</code>
                    <span>{entry.status}</span>
                  </div>
                  <pre class="mt-1 overflow-auto text-[0.65rem]">{JSON.stringify(
                      entry.args,
                      null,
                      2,
                    )}</pre>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
        <section class="space-y-2">
          <h2 class="text-sm font-semibold">{m.sandbox_newWorkspace_invariants_title()}</h2>
          {#if invariantFailures.length === 0}
            <p class="text-xs text-muted-foreground">{m.sandbox_newWorkspace_none_label()}</p>
          {:else}
            <ul class="grid gap-1 text-xs text-danger">
              {#each invariantFailures as failure (failure)}
                <li>{failure}</li>
              {/each}
            </ul>
          {/if}
        </section>
      </aside>
    </div>
  {:else}
    <div class="overflow-hidden rounded-xl border border-border bg-card">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-border bg-muted/50">
          <tr>
            <th class="p-3">{m.sandbox_newWorkspace_family_label()}</th>
            <th class="p-3">{m.sandbox_newWorkspace_scenario_label()}</th>
            <th class="p-3">{m.sandbox_newWorkspace_expectedPhase_label()}</th>
          </tr>
        </thead>
        <tbody>
          {#each NEW_WORKSPACE_SCENARIOS as scenario (scenario.id)}
            <tr class="border-b border-border last:border-0">
              <td class="p-3 text-muted-foreground">{scenario.family}</td>
              <td class="p-3">
                <a class="font-medium text-primary underline" href={scenarioUrl(scenario.id)}>
                  {scenario.title}
                </a>
                <code class="mt-1 block text-xs text-muted-foreground">{scenario.id}</code>
              </td>
              <td class="p-3"><code>{scenario.expectedPhase}</code></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <output
        class="block border-t border-border p-3 text-right text-sm font-semibold"
        data-testid="controller-phase-coverage"
        aria-label={m.sandbox_newWorkspace_description()}>{controllerCoverage}%</output
      >
    </div>
  {/if}
</section>

<style>
  .control {
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius-medium);
    padding: 0.375rem 0.75rem;
    background: hsl(var(--card));
    font-size: var(--text-body-size);
    font-weight: var(--text-body-strong-weight);
  }

  .control:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
</style>
