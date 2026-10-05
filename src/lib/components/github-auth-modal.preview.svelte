<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store } from '$store/renderer/store';
  import {
    initialState,
    setGitHubAuthState,
    setAuthenticating,
    setDeviceFlowInfo,
    setGitHubAuthError,
  } from '$store/renderer/slices/github-auth/github-auth-slice';
  import type { GitHubAuthState } from '$store/renderer/slices/github-auth/github-auth-types';

  function applyState(state: GitHubAuthState) {
    store.dispatch(setGitHubAuthError(state.error));
    if (state.isAuthenticating) store.dispatch(setAuthenticating(true));
    store.dispatch(setDeviceFlowInfo(state.deviceFlow));
    store.dispatch(setGitHubAuthState(state));
  }

  function setup(overrides: Partial<GitHubAuthState>) {
    const previous = store.state.githubAuth;
    applyState({ ...initialState, ...overrides });
    return () => applyState(previous);
  }

  export const preview = definePreview({
    id: 'github-auth-modal',
    title: 'Connect GitHub',
    defaultState: 'ready',
    states: {
      ready: { props: {}, setup: () => setup({}) },
      starting: { props: {}, setup: () => setup({ isAuthenticating: true }) },
      code: {
        props: {},
        setup: () =>
          setup({
            isAuthenticating: true,
            deviceFlow: {
              userCode: 'ABCD-1234',
              verificationUri: 'https://github.com/login/device',
              expiresIn: 900,
              interval: 5,
            },
          }),
      },
      error: {
        props: {},
        setup: () =>
          setup({ error: 'The authorization code expired. Try again to request a new code.' }),
      },
      'daemon-auth': { props: {}, setup: () => setup({ requiresDaemonAuth: true }) },
    },
  });
</script>

<script lang="ts">
  import GitHubAuthModal from './GitHubAuthModal.svelte';
  import { Button } from '$lib/components/ui/button';
  let open = $state(true);
</script>

<div class="min-h-96 p-4">
  <Button onclick={() => (open = true)}>Open GitHub connection</Button>
  <GitHubAuthModal {open} onClose={() => (open = false)} />
</div>
