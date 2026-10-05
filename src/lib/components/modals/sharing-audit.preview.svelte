<script module lang="ts">
  import { definePreview } from '$lib/component-catalog/preview-definition';

  export const preview = definePreview<{ state: string }>({
    id: 'sharing-audit',
    title: 'Sharing and invitation dialogs',
    defaultState: 'share-empty',
    states: Object.fromEntries(
      [
        'share-empty',
        'share-owner-only',
        'share-connect',
        'share-loading',
        'share-error',
        'share-cap',
        'share-creating',
        'share-roster',
        'share-many',
        'share-action-error',
        'share-invites',
        'consent-sign-in',
        'consent-scope',
        'consent-prove',
        'consent-confirm',
        'notice-expired',
        'notice-plaintext',
        'notice-long',
      ].map((state) => [state, { props: { state } }]),
    ),
  });
</script>

<script lang="ts">
  import ShareWorkspaceDialog from './ShareWorkspaceDialog.svelte';
  import InviteConsentModal from './InviteConsentModal.svelte';
  import InviteNoticeModal from './InviteNoticeModal.svelte';
  import type { InviteConsentShowPayload } from '$shared/ipc/invite-consent';

  let { state = 'share-empty' }: { state?: string } = $props();
  const consent = $derived<InviteConsentShowPayload>(
    state === 'consent-sign-in' || state === 'consent-scope'
      ? {
          requestId: state,
          mode: 'sign-in-required',
          workspaceTitle: 'Design system',
          hostLabel: 'Team server',
          reason: state === 'consent-scope' ? 'scope-missing' : 'not-connected',
          userCode: 'ABCD-EFGH',
          verificationUri: 'https://github.com/login/device',
          expiresInMs: 900000,
        }
      : {
          requestId: state,
          mode: state === 'consent-confirm' ? 'confirm' : 'prove',
          workspaceTitle: 'Design system',
          hostLabel: 'Team server',
          login: 'designer',
        },
  );
</script>

{#if state.startsWith('share-')}
  <ShareWorkspaceDialog
    open
    workspaceId="audit"
    workspaceTitle="Design system"
    canManage={state !== 'share-owner-only'}
    githubConnected={state !== 'share-connect'}
    loading={state === 'share-loading'}
    creating={state === 'share-creating'}
    loadError={state === 'share-error'
      ? 'Unable to load members. Check your connection and try again.'
      : null}
    guestCount={state === 'share-cap' ? 5 : 0}
    guestLimit={5}
    members={['share-roster', 'share-many', 'share-action-error'].includes(state)
      ? Array.from({ length: state === 'share-many' ? 20 : 3 }, (_, index) => ({
          principalId: `member-${index}`,
          login: `teammate-${index}`,
          displayName: index === 0 ? 'Workspace owner' : `Design reviewer ${index}`,
          avatarUrl: null,
          role: index === 0 ? 'owner' : 'collaborator',
          addedAt: '2026-09-22T00:00:00Z',
        }))
      : []}
    invites={state === 'share-invites'
      ? [
          {
            id: 'reusable',
            workspaceId: 'audit',
            createdByPrincipalId: 'owner',
            createdAt: '2026-09-22T00:00:00Z',
            expiresAt: '2099-09-29T00:00:00Z',
            reusable: true,
            redemptionCount: 2,
          },
          {
            id: 'pinned',
            workspaceId: 'audit',
            createdByPrincipalId: 'owner',
            createdAt: '2026-09-22T00:00:00Z',
            expiresAt: '2099-09-29T00:00:00Z',
            pinLogin: 'designer',
            reusable: false,
          },
        ]
      : []}
    actionError={state === 'share-action-error' ? 'Unable to remove this member. Try again.' : null}
  />
{:else if state.startsWith('consent-')}
  <InviteConsentModal open payload={consent} />
{:else}
  <InviteNoticeModal
    open
    payload={{
      requestId: state,
      kind: state === 'notice-plaintext' ? 'plaintext' : 'failed',
      reason: 'expired',
      workspaceTitle:
        state === 'notice-long'
          ? 'Workspace-with-a-very-long-unbroken-name-for-checking-dialog-overflow-and-wrapping'
          : 'Design system',
      hostLabel: 'Team server',
    }}
  />
{/if}
