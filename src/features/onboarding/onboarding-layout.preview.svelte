<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { OnboardingStep } from '$store/renderer/slices/onboarding/onboarding-types';
  /** Seeded forge-auth slice state behind the "Connect a forge" step. */
  type ForgeScenario =
    | 'idle'
    | 'github-device'
    | 'gitlab-device'
    | 'gitlab-connecting'
    | 'connected-github'
    | 'connected-gitlab';
  interface Props {
    step?: OnboardingStep;
    compact?: boolean;
    forge?: ForgeScenario;
    gitlabEnabled?: boolean;
    gitlabSetupSupported?: boolean;
    gitlabInstanceBaseUrl?: string;
    settings?: boolean;
    verificationUri?: string;
    onOpenExternal?: (payload: unknown) => void;
  }
  export const preview = definePreview<Props>({
    id: 'onboarding-layout',
    title: 'Onboarding layout',
    defaultState: 'prompt',
    states: {
      welcome: { props: { step: 'welcome' } },
      forge: { props: { step: 'forge' } },
      'forge-gitlab-enabled': { props: { step: 'forge', gitlabEnabled: true } },
      'forge-gitlab-update-required': {
        props: { step: 'forge', gitlabEnabled: true, gitlabSetupSupported: false },
      },
      'forge-github-device': { props: { step: 'forge', forge: 'github-device' } },
      'forge-gitlab-device': {
        props: { step: 'forge', forge: 'gitlab-device', gitlabEnabled: true },
      },
      'settings-gitlab-device': {
        props: { step: 'forge', forge: 'gitlab-device', gitlabEnabled: true, settings: true },
      },
      'settings-gitlab-device-long': {
        props: {
          step: 'forge',
          forge: 'gitlab-device',
          gitlabEnabled: true,
          settings: true,
          verificationUri:
            'https://engineeringgitlabinstancewithaverylongunbrokensubdomain.internal.example.test:8443/company/platform/identity/authorization/device',
        },
      },
      'forge-gitlab-connecting': {
        props: { step: 'forge', forge: 'gitlab-connecting', gitlabEnabled: true },
      },
      'forge-connected-github': { props: { step: 'forge', forge: 'connected-github' } },
      'forge-connected-gitlab': { props: { step: 'forge', forge: 'connected-gitlab' } },
      project: { props: { step: 'project' } },
      prompt: { props: { step: 'configuring' } },
      'new-workspace': { props: { compact: true } },
    },
  });
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import OnboardingPage from './OnboardingPage.svelte';
  import GitLabAuthConnection from '$lib/components/settings/GitLabAuthConnection.svelte';
  import { overrideMockIpcHandler } from '$shared/ipc-mock-router';
  import CompactWorkspaceInitializer from '$lib/components/workspace/CompactWorkspaceInitializer.svelte';
  import { previewProviders } from '$lib/components/settings/provider-selector.preview';
  import { store as appStore } from '$store/renderer/store';
  import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { setLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
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
  import {
    setAuthenticating as setGitHubAuthenticating,
    setDeviceFlowInfo as setGitHubDeviceFlowInfo,
    setGitHubAuthError,
    setGitHubAuthState,
  } from '$store/renderer/slices/github-auth/github-auth-slice';
  import type { GitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-types';
  import {
    setGitLabAuthenticating,
    setGitLabAuthError,
    setGitLabAuthStatus,
    setGitLabDeviceFlowInfo,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import type { GitLabAuthState } from '$store/renderer/slices/gitlab-auth/gitlab-auth-types';
  import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
  import {
    principalContextChanged,
    principalReceived,
  } from '$store/renderer/slices/principal/principal-slice';

  let {
    step = 'configuring',
    compact = false,
    forge = 'idle',
    gitlabEnabled = false,
    gitlabSetupSupported = true,
    gitlabInstanceBaseUrl = 'https://gitlab.example.com',
    settings = false,
    verificationUri,
    onOpenExternal,
  }: Props = $props();
  const restoreOpen = untrack(() =>
    // eslint-disable-next-line intent/no-component-async-data-fetch -- Fixture-only navigation interception; restores the original mock handler on teardown and never fetches domain data.
    onOpenExternal ? overrideMockIpcHandler('shell:openExternal', onOpenExternal) : undefined,
  );
  const previousGitLabEnabled = appStore.state.userPreferences.labsGitLabEnabled;
  const previousStep = selectOnboardingStep.select(appStore.state);
  const previousProviders = selectProviderCatalogEntries.select(appStore.state);
  const previousStatuses = selectProviderStatusMap.select(appStore.state);
  const previousLoading = selectProviderLoadingMap.select(appStore.state);
  const previousGitHub: GitHubAuthState = appStore.state.githubAuth;
  const previousGitLab: GitLabAuthState = appStore.state.gitlabAuth;
  const previousPrincipal = appStore.state.principal;

  const DEVICE_CODES = {
    userCode: 'WDJB-MJHT',
    verificationUri: 'https://gitlab.example.com/oauth/device',
    expiresIn: 900,
    interval: 5,
  };

  function applyGitHub(state: GitHubAuthState) {
    appStore.dispatch(
      setGitHubAuthState({
        isAuthenticated: state.isAuthenticated,
        requiresDaemonAuth: state.requiresDaemonAuth,
        user: state.user,
        needsScopeUpdate: state.needsScopeUpdate,
        oauthUrl: state.oauthUrl,
      }),
    );
    // setError also resets the in-flight flow, so it goes before the flow fields.
    appStore.dispatch(setGitHubAuthError(state.error));
    appStore.dispatch(setGitHubAuthenticating(state.isAuthenticating));
    appStore.dispatch(setGitHubDeviceFlowInfo(state.deviceFlow));
  }

  function applyGitLab(state: GitLabAuthState) {
    appStore.dispatch(
      setGitLabAuthStatus({
        host: state.host,
        ...(state.instanceBaseUrl ? { instanceBaseUrl: state.instanceBaseUrl } : {}),
        isConfigured: state.isConfigured,
        deviceGrantSupported: state.deviceGrantSupported,
        user: state.user,
        method: state.method,
      }),
    );
    appStore.dispatch(setGitLabAuthError(state.error));
    appStore.dispatch(setGitLabAuthenticating(state.isAuthenticating));
    appStore.dispatch(setGitLabDeviceFlowInfo(state.deviceFlow));
  }

  function seedForge(scenario: ForgeScenario) {
    const github: GitHubAuthState = {
      ...previousGitHub,
      isAuthenticated: false,
      requiresDaemonAuth: false,
      user: null,
      isAuthenticating: false,
      deviceFlow: null,
      error: null,
    };
    const gitlab: GitLabAuthState = {
      ...previousGitLab,
      host: 'gitlab.com',
      isConfigured: false,
      isAuthenticating: false,
      deviceFlow: null,
      deviceGrantSupported: true,
      user: null,
      error: null,
      method: null,
    };
    switch (scenario) {
      case 'github-device':
        github.isAuthenticating = true;
        github.deviceFlow = { ...DEVICE_CODES, verificationUri: 'https://github.com/login/device' };
        break;
      case 'gitlab-device':
        gitlab.host = 'gitlab.example.com';
        gitlab.isAuthenticating = true;
        gitlab.deviceFlow = {
          ...DEVICE_CODES,
          verificationUri: verificationUri ?? DEVICE_CODES.verificationUri,
        };
        break;
      case 'gitlab-connecting':
        gitlab.host = 'gitlab.example.com';
        gitlab.deviceGrantSupported = false;
        gitlab.isAuthenticating = true;
        break;
      case 'connected-github':
        github.isAuthenticated = true;
        github.user = { login: 'octocat', name: 'Octo Cat', email: null, avatar_url: '' };
        break;
      case 'connected-gitlab':
        gitlab.host = 'gitlab.example.com';
        gitlab.isConfigured = true;
        gitlab.method = 'pat';
        gitlab.user = { id: '7', login: 'jdoe', displayName: 'J. Doe' };
        break;
      case 'idle':
        break;
    }
    const instance = untrack(() => gitlabInstanceBaseUrl);
    gitlab.host = new URL(instance).host;
    gitlab.instanceBaseUrl = instance;
    applyGitHub(github);
    applyGitLab(gitlab);
  }
  const seededForge = untrack(() => step === 'forge');
  if (seededForge) {
    // The browser mock advertises no setup capability. These fixture scenes
    // explicitly admit the selected host and declare its support independently.
    appStore.dispatch(
      systemStatusSuccess(
        {
          running: true,
          listenMode: 'local',
          protocolVersion: '10.5',
          host: { os: 'linux', arch: 'x86_64', locality: 'local' },
        },
        new Date().toISOString(),
        appStore.state.daemonHealth.connectionGeneration,
      ),
    );
    admitLegacyPrincipal();
    const { context, invalidation, presentationVersion, snapshot } = appStore.state.principal;
    appStore.dispatch(
      principalReceived(
        { context: context!, invalidation, presentationVersion },
        {
          ...snapshot!,
          capabilities: {
            ...snapshot!.capabilities,
            gitlabCheckout: untrack(() => gitlabSetupSupported),
          },
        },
      ),
    );
    appStore.dispatch(setLabsGitLabEnabled(untrack(() => gitlabEnabled)));
    seedForge(untrack(() => forge));
  }
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
    restoreOpen?.();
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
    if (seededForge) {
      applyGitHub(previousGitHub);
      applyGitLab(previousGitLab);
      appStore.dispatch(setLabsGitLabEnabled(previousGitLabEnabled));
      appStore.dispatch(principalContextChanged(previousPrincipal.context));
      if (previousPrincipal.context && previousPrincipal.snapshot) {
        appStore.dispatch(
          principalReceived(
            { context: previousPrincipal.context, invalidation: 0, presentationVersion: 0 },
            previousPrincipal.snapshot,
          ),
        );
      }
    }
  });
</script>

<div class="relative h-[720px] w-full" data-onboarding-layout-fixture>
  {#if settings}
    <div class="p-6"><GitLabAuthConnection /></div>
  {:else if compact}
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
