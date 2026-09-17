<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { OnboardingStep } from '$store/renderer/slices/onboarding/onboarding-types';
  interface Props {
    step?: OnboardingStep;
    compact?: boolean;
  }
  export const preview = definePreview<Props>({
    id: 'onboarding-layout',
    title: 'Onboarding layout',
    defaultState: 'prompt',
    states: {
      welcome: { props: { step: 'welcome' } },
      github: { props: { step: 'github' } },
      project: { props: { step: 'project' } },
      prompt: { props: { step: 'configuring' } },
      'new-workspace': { props: { compact: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import OnboardingPage from './OnboardingPage.svelte';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import { previewProviders } from '$lib/components/settings/provider-selector.preview';
  import { store as appStore } from '$store/renderer/store';
  import { goToStep } from '$store/renderer/slices/onboarding/onboarding-slice';
  import { selectOnboardingStep } from '$store/renderer/slices/onboarding/onboarding-selectors';
  import { selectProviderCatalogEntries } from '$store/renderer/slices/provider-catalog/provider-catalog-selectors';
  import { providerCatalogLoaded } from '$store/renderer/slices/provider-catalog/provider-catalog-slice';
  import {
    selectProviderStatusMap,
    selectProviderLoadingMap,
  } from '$store/renderer/slices/agent-availability/agent-availability-selectors';
  import {
    checkSingleProviderSuccess,
    checkAllProvidersComplete,
    setAllProvidersLoading,
  } from '$store/renderer/slices/agent-availability/agent-availability-slice';

  let { step = 'configuring', compact = false }: Props = $props();
  const previousStep = selectOnboardingStep.select(appStore.state);
  const previousProviders = selectProviderCatalogEntries.select(appStore.state);
  const previousStatuses = selectProviderStatusMap.select(appStore.state);
  const previousLoading = selectProviderLoadingMap.select(appStore.state);
  appStore.dispatch(providerCatalogLoaded({ providers: previewProviders }));
  for (const provider of previewProviders) {
    appStore.dispatch(
      checkSingleProviderSuccess(provider.id, {
        available: provider.id !== 'opencode',
        authenticated: provider.id !== 'opencode',
      }),
    );
  }
  appStore.dispatch(checkAllProvidersComplete());
  appStore.dispatch(goToStep(untrack(() => step)));
  onDestroy(() => {
    appStore.dispatch(goToStep(previousStep));
    appStore.dispatch(providerCatalogLoaded({ providers: previousProviders }));
    for (const provider of previewProviders) {
      appStore.dispatch(
        checkSingleProviderSuccess(
          provider.id,
          previousStatuses[provider.id] ?? { available: false },
        ),
      );
    }
    appStore.dispatch(setAllProvidersLoading(previousLoading));
  });
</script>

<div class="relative h-[720px] w-full" data-onboarding-layout-fixture>
  {#if compact}
    <div class="p-6"><CompactWorkspaceInitializer isExpanded={true} /></div>
  {:else}
    <OnboardingPage
      isOnboarding={false}
      fadingOut={false}
      onHoldActiveChange={() => {}}
      onFadingOutChange={() => {}}
    />
  {/if}
</div>
