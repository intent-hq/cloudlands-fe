<script module lang="ts">
  /**
   * ShareWorkspaceDialog states for the GitLab identity seam: the pin-forge
   * selector, provider-aware member and invite rows, and the fallbacks for a
   * daemon without the seam capability and for a host with no forge connected.
   */
  import { definePreview } from '$lib/component-catalog/preview-definition';
  import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import type {
    HostPrincipal,
    IdentityProvider,
    WorkspaceInvite,
  } from '$features/workspace-sharing/types';

  interface ShareDialogPreviewProps {
    githubConnected: boolean;
    gitlabConnected: boolean;
    identitySeamSupported: boolean;
    identityProvider: IdentityProvider | null;
    members: WorkspaceMember[];
    invites: WorkspaceInvite[];
    principals: HostPrincipal[];
  }

  const GITLAB_HOST = 'gitlab.example.com';
  const WORKSPACE_ID = 'ws-share-preview';

  const owner: WorkspaceMember = {
    principalId: 'principal-owner',
    login: 'octocat',
    displayName: 'Octo Cat',
    avatarUrl: null,
    role: 'owner',
    addedAt: '2026-09-01T09:00:00Z',
    identity: { provider: 'github', host: 'github.com', externalUserId: '583231' },
  };
  const gitlabGuest: WorkspaceMember = {
    principalId: 'principal-gitlab-guest',
    login: 'mara.dev',
    displayName: 'Mara Ostrowski',
    avatarUrl: null,
    role: 'collaborator',
    addedAt: '2026-09-10T14:30:00Z',
    identity: { provider: 'gitlab', host: GITLAB_HOST, externalUserId: '4021' },
  };
  const githubGuest: WorkspaceMember = {
    principalId: 'principal-github-guest',
    login: 'hubot',
    displayName: null,
    avatarUrl: null,
    role: 'collaborator',
    addedAt: '2026-09-12T08:15:00Z',
    identity: { provider: 'github', host: 'github.com', externalUserId: '480938' },
  };
  const legacyGuest: WorkspaceMember = {
    principalId: 'principal-legacy-guest',
    login: 'defunkt',
    displayName: 'Chris W.',
    avatarUrl: null,
    role: 'collaborator',
    addedAt: '2026-08-20T11:00:00Z',
  };

  const gitlabPinnedInvite: WorkspaceInvite = {
    id: 'invite-gitlab-pinned',
    workspaceId: WORKSPACE_ID,
    createdByPrincipalId: owner.principalId,
    pinLogin: 'sven.k',
    pinIdentity: { provider: 'gitlab', host: GITLAB_HOST, externalUserId: '7788' },
    createdAt: '2026-09-20T10:00:00Z',
    expiresAt: '2026-09-27T10:00:00Z',
  };
  const githubPinnedInvite: WorkspaceInvite = {
    id: 'invite-github-pinned',
    workspaceId: WORKSPACE_ID,
    createdByPrincipalId: owner.principalId,
    pinGithubUserId: 1024025,
    pinLogin: 'torvalds',
    pinIdentity: { provider: 'github', host: 'github.com', externalUserId: '1024025' },
    createdAt: '2026-09-20T10:05:00Z',
    expiresAt: '2026-09-27T10:05:00Z',
  };
  const openInvite: WorkspaceInvite = {
    id: 'invite-open',
    workspaceId: WORKSPACE_ID,
    createdByPrincipalId: owner.principalId,
    createdAt: '2026-09-20T10:10:00Z',
    expiresAt: '2026-09-27T10:10:00Z',
    reusable: true,
    redemptionCount: 2,
  };

  const knownGuest: HostPrincipal = {
    principalId: 'principal-known-guest',
    login: 'lena.r',
    displayName: 'Lena Ruiz',
    avatarUrl: null,
    githubUserId: null,
  };

  const bothConnected: ShareDialogPreviewProps = {
    githubConnected: true,
    gitlabConnected: true,
    identitySeamSupported: true,
    identityProvider: 'gitlab',
    members: [owner, gitlabGuest, githubGuest, legacyGuest],
    invites: [gitlabPinnedInvite, githubPinnedInvite, openInvite],
    principals: [knownGuest],
  };

  export const preview = definePreview<ShareDialogPreviewProps>({
    id: 'share-workspace-dialog',
    title: 'Share workspace dialog (identity seam)',
    defaultState: 'both-connected',
    states: {
      'both-connected': { props: bothConnected },
      'gitlab-only': {
        props: { ...bothConnected, githubConnected: false, invites: [gitlabPinnedInvite] },
      },
      'pre-seam-daemon': {
        props: {
          ...bothConnected,
          identitySeamSupported: false,
          identityProvider: null,
          members: [owner, githubGuest, legacyGuest].map(({ identity: _identity, ...row }) => row),
          invites: [{ ...githubPinnedInvite, pinIdentity: undefined }, openInvite],
        },
      },
      'no-forge': {
        props: {
          ...bothConnected,
          githubConnected: false,
          gitlabConnected: false,
          identityProvider: null,
          members: [owner],
          invites: [],
          principals: [],
        },
      },
    },
  });
</script>

<script lang="ts">
  import ShareWorkspaceDialog from './ShareWorkspaceDialog.svelte';

  let props: ShareDialogPreviewProps = $props();
</script>

<div class="relative min-h-[1000px] w-full">
  <ShareWorkspaceDialog
    open
    workspaceId={WORKSPACE_ID}
    workspaceTitle="Polish workspace hover cards"
    gitlabHost={GITLAB_HOST}
    canManage
    guestCount={3}
    guestLimit={5}
    {...props}
  />
</div>
