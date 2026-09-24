<script module lang="ts">
  /**
   * Guest-side join prompts for the GitLab identity seam: the consent modal
   * naming the forge the proof is made on (GitLab instance vs GitHub), the
   * neutral connect-first prompt when no forge is connected, the
   * sign-in-required prompt, and the `identity-unverifiable` notice naming
   * the forge instance the host could not read the proof on.
   */
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { InviteConsentShowPayload } from '$shared/ipc/invite-consent';
  import type { InviteNoticeShowPayload } from '$shared/ipc/invite-notice';

  interface InviteJoinPromptsProps {
    consent?: InviteConsentShowPayload;
    notice?: InviteNoticeShowPayload;
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
        props: { consent: { ...base, mode: 'connect-forge' } },
      },
      'sign-in-required': {
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
      'notice-pin-mismatch': {
        props: { notice: { ...base, kind: 'failed', reason: 'pin-mismatch' } },
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

  let { consent, notice }: InviteJoinPromptsProps = $props();
</script>

<div class="relative min-h-[560px] w-full">
  {#if consent}
    <InviteConsentModal open payload={consent} />
  {/if}
  {#if notice}
    <InviteNoticeModal open payload={notice} />
  {/if}
</div>
