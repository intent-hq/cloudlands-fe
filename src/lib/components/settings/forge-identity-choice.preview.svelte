<script module lang="ts">
  /**
   * ForgeIdentityChoice states: the row reads the daemon's own identity
   * (`principal.me`) and the connected forges from the store, so each state
   * seeds the identity, daemon-health and forge-auth slices and restores them
   * on teardown.
   */
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import { systemStatusSuccess } from '$store/renderer/slices/daemon-health/daemon-health-slice';
  import { setGitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-slice';
  import { setGitLabAuthStatus } from '$store/renderer/slices/gitlab-auth/gitlab-auth-slice';
  import { identityLoaded, principalLoaded } from '$store/renderer/slices/identity/identity-slice';
  import type { IdentityProvider, PrincipalIdentity } from '$features/workspace-sharing/types';

  const GITLAB_HOST = 'gitlab.example.com';

  interface IdentityScenario {
    github: boolean;
    gitlab: boolean;
    /** The `identity.provider` setting; `null` when unset. */
    setting: IdentityProvider | null;
    /** The triple `principal.me` holds; `null` while unlinked. */
    current: PrincipalIdentity | null;
    login: string | null;
  }

  function setup(scenario: IdentityScenario) {
    const before = appStore.state;
    const githubBefore = before.githubAuth;
    const gitlabBefore = before.gitlabAuth;
    const identityBefore = before.identity;
    appStore.dispatch(
      systemStatusSuccess(
        {
          running: true,
          listenMode: 'local',
          protocolVersion: '10.8',
          host: { os: 'linux', arch: 'x86_64', locality: 'local' },
        },
        new Date().toISOString(),
        before.daemonHealth.connectionGeneration,
      ),
    );
    appStore.dispatch(
      setGitHubAuthState({
        isAuthenticated: scenario.github,
        requiresDaemonAuth: false,
        user: scenario.github
          ? { login: 'octocat', name: 'Octo Cat', email: null, avatar_url: '' }
          : null,
        needsScopeUpdate: false,
        oauthUrl: null,
      }),
    );
    appStore.dispatch(
      setGitLabAuthStatus({
        host: GITLAB_HOST,
        isConfigured: scenario.gitlab,
        deviceGrantSupported: true,
        user: scenario.gitlab ? { id: '4021', login: 'mara.dev', displayName: 'Mara' } : null,
        method: scenario.gitlab ? 'device' : null,
      }),
    );
    appStore.dispatch(identityLoaded(scenario.setting));
    appStore.dispatch(principalLoaded(scenario.current, scenario.login));
    return () => {
      appStore.dispatch(
        setGitHubAuthState({
          isAuthenticated: githubBefore.isAuthenticated,
          requiresDaemonAuth: githubBefore.requiresDaemonAuth,
          user: githubBefore.user,
          needsScopeUpdate: githubBefore.needsScopeUpdate,
          oauthUrl: githubBefore.oauthUrl,
        }),
      );
      appStore.dispatch(
        setGitLabAuthStatus({
          host: gitlabBefore.host,
          isConfigured: gitlabBefore.isConfigured,
          deviceGrantSupported: gitlabBefore.deviceGrantSupported,
          user: gitlabBefore.user,
          method: gitlabBefore.method,
        }),
      );
      appStore.dispatch(identityLoaded(identityBefore.provider));
      appStore.dispatch(
        principalLoaded(identityBefore.currentIdentity, identityBefore.currentLogin),
      );
    };
  }

  const gitlabIdentity: PrincipalIdentity = {
    provider: 'gitlab',
    host: GITLAB_HOST,
    externalUserId: '4021',
  };
  const githubIdentity: PrincipalIdentity = {
    provider: 'github',
    host: 'github.com',
    externalUserId: '583231',
  };

  export const preview = definePreview<Record<string, never>>({
    id: 'forge-identity-choice',
    title: 'Forge identity choice',
    defaultState: 'both-connected-gitlab',
    states: {
      'both-connected-gitlab': {
        props: {},
        setup: () =>
          setup({
            github: true,
            gitlab: true,
            setting: 'gitlab',
            current: gitlabIdentity,
            login: 'mara.dev',
          }),
      },
      'github-only': {
        props: {},
        setup: () =>
          setup({
            github: true,
            gitlab: false,
            setting: null,
            current: githubIdentity,
            login: 'octocat',
          }),
      },
      'unlinked-disconnected-choice': {
        props: {},
        setup: () =>
          setup({ github: true, gitlab: false, setting: 'gitlab', current: null, login: null }),
      },
    },
  });
</script>

<script lang="ts">
  import ForgeIdentityChoice from './ForgeIdentityChoice.svelte';
</script>

<div class="w-full max-w-2xl p-4">
  <ForgeIdentityChoice />
</div>
