<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { setupPreviewProviders } from '$lib/components/settings/provider-selector.preview';
  import {
    setupModelPickerPreviewHandler,
    setupProviderSelectorPreviewHandlers,
  } from '../../../../test/catalog-preview-ipc';

  function setupPickerProviders() {
    const restoreProviders = setupPreviewProviders();
    const unavailable = { available: false };
    const restoreAvailability = setupProviderSelectorPreviewHandlers({
      hasAnyProvider: true,
      hiddenProviders: [],
      providers: {
        codex: { available: true, authenticated: true },
        claudeCode: unavailable,
        auggie: unavailable,
        cortex: unavailable,
        mock: unavailable,
        opencode: unavailable,
        pi: unavailable,
        droid: unavailable,
        grok: unavailable,
        unsloth: unavailable,
      },
    });
    const restoreModels = setupModelPickerPreviewHandler('codex', [
      { value: 'fixture-model', label: 'Fixture model' },
    ]);
    return () => {
      restoreModels();
      restoreAvailability();
      restoreProviders();
    };
  }

  interface Props {
    state?: 'populated' | 'empty' | 'compact' | 'welcome';
  }
  export const preview = definePreview<Props>({
    id: 'initial-agent-picker',
    title: 'Initial agent picker',
    defaultState: 'populated',
    states: {
      populated: { props: { state: 'populated' } },
      empty: { props: { state: 'empty' } },
      compact: { props: { state: 'compact' } },
      welcome: { props: { state: 'welcome' } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import InitialAgentPicker from './InitialAgentPicker.svelte';
  import SpecialistDropdown from '$lib/components/chat/SpecialistDropdown.svelte';
  import RegularAgentWelcome from '$lib/components/chat/RegularAgentWelcome.svelte';
  import type { AgentSession } from '$shared/types/agent-session';
  import { store } from '$store/renderer/store';
  import {
    setFileSpecialists,
    setFileSpecialistsLoaded,
    setCustomSpecialistsLoaded,
  } from '$store/renderer/slices/specialists/specialists-slice';
  import {
    selectFileSpecialists,
    selectFileSpecialistsLoaded,
    selectCustomSpecialistsLoaded,
  } from '$store/renderer/slices/specialists/specialists-selectors';

  let { state: scenario = 'populated' }: Props = $props();
  let selected = $state<string | null>(
    untrack(() => (scenario === 'welcome' ? 'fixture-developer' : null)),
  );
  const welcomeSession = $derived({
    id: 'fixture-welcome-agent',
    backendSessionId: null,
    metadata: { specialist: selected },
  } as AgentSession);
  onDestroy(setupPickerProviders());
  const previousFiles = selectFileSpecialists.select(store.state);
  const previousFilesLoaded = selectFileSpecialistsLoaded.select(store.state);
  const previousCustomLoaded = selectCustomSpecialistsLoaded.select(store.state);
  store.dispatch(
    setFileSpecialists(
      untrack(() =>
        scenario === 'empty'
          ? []
          : [
              {
                id: 'fixture-developer',
                name: 'Developer',
                description: 'Builds and verifies focused changes.',
                model: 'fixture-model',
                codingAgent: 'codex',
                behaviorPrompt:
                  '## Developer\n\nWork on one focused task at a time.\n\nInspect the relevant components before changing them.\n\nUse the existing design system.\n\nPreserve keyboard and pointer behavior.\n\nVerify narrow and wide layouts.\n\nRun focused tests and report the results.',
                filePath: '/fixture/developer.md',
                source: 'user',
                icon: 'developer',
              },
              {
                id: 'fixture-long',
                name: 'A specialist with a very long descriptive name',
                description:
                  'Investigates difficult rendering problems and verifies accessible behavior in narrow application panels.',
                model: 'fixture-model',
                codingAgent: 'codex',
                behaviorPrompt: '',
                filePath: '/fixture/long.md',
                source: 'user',
                icon: 'reviewer',
              },
            ],
      ),
    ),
  );
  store.dispatch(setCustomSpecialistsLoaded(true));
  store.dispatch(setFileSpecialistsLoaded(true));
  onDestroy(() => {
    store.dispatch(setFileSpecialists(previousFiles));
    store.dispatch(setFileSpecialistsLoaded(previousFilesLoaded));
    store.dispatch(setCustomSpecialistsLoaded(previousCustomLoaded));
  });
</script>

<section class="w-full min-w-0 p-4" data-testid="specialist-fixture">
  {#if scenario === 'compact'}
    <SpecialistDropdown value={selected} onchange={(value) => (selected = value)} />
  {:else if scenario === 'welcome'}
    <RegularAgentWelcome
      session={welcomeSession}
      onSpecialistChange={(value) => (selected = value)}
    />
  {:else}
    <InitialAgentPicker bind:selectedSpecialist={selected} selectedProvider="codex" />
  {/if}
  <output class="sr-only" data-testid="specialist-selection">{selected ?? 'general'}</output>
</section>
