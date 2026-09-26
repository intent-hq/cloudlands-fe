<script module lang="ts">
  /**
   * Guest-side join prompts for the GitLab identity seam: the consent modal
   * naming the forge the proof is made on (GitLab instance vs GitHub), the
   * neutral connect-first prompt when no forge is connected, the
   * sign-in-required prompt, and the `identity-unverifiable` notice naming
   * the forge instance the host could not read the proof on.
   */
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import { store as appStore } from '$store/renderer/store';
  import { setLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-slice';
  import type { InviteConsentShowPayload } from '$shared/ipc/invite-consent';
  import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';
  import { closePalette } from '$store/renderer/slices/palette/palette-slice';

  interface InviteJoinPromptsProps {
    consent?: InviteConsentShowPayload;
    notice?: InviteNoticeShowPayload;
  }

  function enableGitLab() {
    const before = appStore.state.userPreferences.labsGitLabEnabled;
    appStore.dispatch(setLabsGitLabEnabled(true));
    return () => appStore.dispatch(setLabsGitLabEnabled(before));
  }

  function setupGitLabRecovery() {
    const before = appStore.state.userPreferences.labsGitLabEnabled;
    appStore.dispatch(setLabsGitLabEnabled(false));
    appStore.dispatch(closePalette());
    return () => {
      appStore.dispatch(closePalette());
      appStore.dispatch(setLabsGitLabEnabled(before));
    };
  }

  const GITLAB_HOST = 'gitlab.example.com';
  const base = {
    requestId: 'preview-request',
    workspaceTitle: 'Polish workspace hover cards',
    hostLabel: 'intent.example.net:8443',
  };

  export const preview = definePreview<InviteJoinPromptsProps>({
    id: 'invite-join-prompts',
    title: 'Invite join prompts (identity seam)',
    defaultState: 'prove-gitlab',
    states: {
      'prove-gitlab': {
        props: {
          consent: {
            ...base,
            mode: 'prove',
            login: 'mara.dev',
            identity: { provider: 'gitlab', host: GITLAB_HOST },
          },
        },
      },
      'prove-github': {
        props: { consent: { ...base, mode: 'prove', login: 'octocat' } },
      },
      'confirm-returning': {
        props: { consent: { ...base, mode: 'confirm', login: 'octocat' } },
      },
      'connect-forge': {
        setup: enableGitLab,
        props: { consent: { ...base, mode: 'connect-forge' } },
      },
      'sign-in-required': {
        setup: enableGitLab,
        props: {
          consent: {
            ...base,
            mode: 'sign-in-required',
            reason: 'not-connected',
            userCode: 'ABCD-1234',
            verificationUri: 'https://github.com/login/device',
            expiresInMs: 900_000,
          },
        },
      },
      'notice-identity-unverifiable': {
        props: {
          notice: {
            requestId: base.requestId,
            kind: 'failed',
            reason: 'identity-unverifiable',
            workspaceTitle: base.workspaceTitle,
            hostLabel: base.hostLabel,
            identityHost: GITLAB_HOST,
          },
        },
      },
      'connect-forge-lab-off': {
        props: { consent: { ...base, mode: 'connect-forge' } },
      },
      'notice-pin-mismatch': {
        props: { notice: { ...base, kind: 'failed', reason: 'pin-mismatch' } },
      },
      'notice-gitlab-pin-mismatch': {
        setup: setupGitLabRecovery,
        props: {
          notice: { ...base, kind: 'failed', reason: 'pin-mismatch', accountProvider: 'gitlab' },
        },
      },
      'notice-identity-unavailable': {
        props: { notice: { ...base, kind: 'failed', reason: 'identity-unavailable' } },
      },
    },
  });
</script>

<script lang="ts">
  import InviteConsentModal from './InviteConsentModal.svelte';
  import InviteNoticeModal from './InviteNoticeModal.svelte';
  import CommandPalette from '../CommandPalette.svelte';
  import {
    selectIsPaletteOpen,
    selectPaletteQuery,
  } from '$store/renderer/slices/palette/palette-selectors';

  let { consent, notice }: InviteJoinPromptsProps = $props();
  const isPaletteOpen$ = selectIsPaletteOpen();
  const paletteQuery$ = selectPaletteQuery();
</script>

<div class="relative min-h-[560px] w-full">
  {#if consent}
    <InviteConsentModal open payload={consent} />
  {/if}
  {#if notice}
    <InviteNoticeModal open payload={notice} />
  {/if}
  <CommandPalette
    isOpen={$isPaletteOpen$}
    initialQuery={$paletteQuery$}
    onClose={() => appStore.dispatch(closePalette())}
  />
</div>
