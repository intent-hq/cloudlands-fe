<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import {
    setLabsGitLabEnabled,
    setLabsMultiplayerEnabled,
  } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import type { CollaborationView } from '../types';

  function setup() {
    const before = appStore.state.userPreferences;
    appStore.dispatch(setLabsMultiplayerEnabled(true));
    appStore.dispatch(setLabsGitLabEnabled(true));
    return () => {
      appStore.dispatch(setLabsMultiplayerEnabled(before.labsMultiplayerEnabled));
      appStore.dispatch(setLabsGitLabEnabled(before.labsGitLabEnabled));
    };
  }
  const github = { provider: 'github' as const, host: 'github.com', externalUserId: '42' };
  const gitlab = {
    provider: 'gitlab' as const,
    host: 'gitlab.company.example:8443',
    externalUserId: '4711',
  };
  const base: CollaborationView = {
    requestId: 'controlled-preview',
    request: { scope: 'workspace', pinIdentity: github, hostLabel: 'Team development host' },
    target: github,
    phase: 'account',
    user: { id: '42', login: 'mara.dev' },
    requestedScopes: ['gist'],
    grantedScopes: ['gist', 'repo', 'workflow'],
    deviceGrantSupported: true,
  };
  export const preview = definePreview<{ view: CollaborationView; static?: boolean }>({
    id: 'collaboration-sign-in',
    title: 'Collaboration sign-in (fixture)',
    defaultState: 'github-consent',
    states: {
      'github-consent': { setup, props: { view: base, static: true } },
      'gitlab-pat': {
        setup,
        props: {
          static: true,
          view: {
            ...base,
            target: gitlab,
            request: { scope: 'host', pinIdentity: gitlab, hostLabel: 'Team development host' },
            user: null,
            requestedScopes: ['api'],
            grantedScopes: null,
            deviceGrantSupported: false,
          },
        },
      },
      'gitlab-pat-live': {
        setup,
        props: {
          view: {
            ...base,
            target: gitlab,
            request: { scope: 'host', pinIdentity: gitlab, hostLabel: 'Team development host' },
            user: null,
            requestedScopes: ['api'],
            grantedScopes: null,
            deviceGrantSupported: false,
          },
        },
      },
    },
  });
</script>

<script lang="ts">
  import CollaborationSignInModal from './CollaborationSignInModal.svelte';
  let { view, static: staticPosition = false }: { view: CollaborationView; static?: boolean } =
    $props();
  let open = $state(true);
</script>

{#if open}
  <CollaborationSignInModal
    {view}
    static={staticPosition}
    onAction={(action) => {
      if (action.type === 'cancel') open = false;
    }}
  />
{/if}
