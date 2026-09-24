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
  }
  export const preview = definePreview<Props>({
    id: 'onboarding-layout',
    title: 'Onboarding layout',
    defaultState: 'prompt',
    states: {
      welcome: { props: { step: 'welcome' } },
      forge: { props: { step: 'forge' } },
      'forge-gitlab-enabled': { props: { step: 'forge', gitlabEnabled: true } },
      'forge-github-device': { props: { step: 'forge', forge: 'github-device' } },
      'forge-gitlab-device': {
        props: { step: 'forge', forge: 'gitlab-device', gitlabEnabled: true },
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

  let {
    step = 'configuring',
    compact = false,
    forge = 'idle',
    gitlabEnabled = false,
  }: Props = $props();
  const previousGitLabEnabled = appStore.state.userPreferences.labsGitLabEnabled;
  const previousStep = selectOnboardingStep.select(appStore.state);
  const previousProviders = selectProviderCatalogEntries.select(appStore.state);
  const previousStatuses = selectProviderStatusMap.select(appStore.state);
  const previousLoading = selectProviderLoadingMap.select(appStore.state);
  const previousGitHub: GitHubAuthState = appStore.state.githubAuth;
  const previousGitLab: GitLabAuthState = appStore.state.gitlabAuth;

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
        gitlab.deviceFlow = DEVICE_CODES;
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
    applyGitHub(github);
    applyGitLab(gitlab);
  }
  const seededForge = untrack(() => step === 'forge');
  if (seededForge) {
    // The browser mock intentionally advertises no protocol capabilities.
    // These scenes exercise a daemon that can serve GitLab authentication.
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
    }
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
