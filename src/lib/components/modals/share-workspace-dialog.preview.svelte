<script module lang="ts">
  /**
   * ShareWorkspaceDialog states for the GitLab identity seam: the pin-forge
   * selector, provider-aware member and invite rows, and the fallbacks for a
   * daemon without the seam capability and for a host with no forge connected.
   */
  import type { WorkspaceGuestRole } from '$shared/types';
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
    gitlabEnabled: boolean;
    identitySeamSupported: boolean;
    identityProvider: IdentityProvider | null;
    members: WorkspaceMember[];
    invites: WorkspaceInvite[];
    principals: HostPrincipal[];
    sharingEnabled?: boolean | null;
    sharingChecking?: boolean;
    sharingEnabling?: boolean;
    sharingError?: string | null;
    canAdministerHost?: boolean;
    workspaceTitle?: string;
    guestLimit?: number;
    inviteDelayMs?: number;
    canSetMemberRole?: boolean;
    ownerPrincipalId?: string;
    pendingRolePrincipalIds?: string[];
    roleErrors?: Record<string, string>;
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
    gitlabEnabled: true,
    identitySeamSupported: true,
    identityProvider: 'gitlab',
    members: [owner, gitlabGuest, githubGuest, legacyGuest],
    invites: [gitlabPinnedInvite, githubPinnedInvite, openInvite],
    principals: [knownGuest],
  };
  const sharingSetup: ShareDialogPreviewProps = {
    ...bothConnected,
    gitlabConnected: false,
    gitlabEnabled: false,
    identityProvider: 'github',
    members: [{ ...owner, displayName: 'Sam Breed', login: 'wookiehangover' }],
    invites: [],
    principals: [],
    sharingEnabled: false,
    workspaceTitle: 'Intent Site',
    guestLimit: 10,
  };

  const guestRoles: ShareDialogPreviewProps = {
    ...sharingSetup,
    sharingEnabled: true,
    canSetMemberRole: true,
    ownerPrincipalId: owner.principalId,
    members: [
      ...sharingSetup.members,
      { ...githubGuest, displayName: 'Alexandra Chen', hostRole: 'guest' },
      { ...gitlabGuest, role: 'manager', hostRole: 'guest' },
      { ...legacyGuest, displayName: 'Host teammate', hostRole: 'member' },
    ],
  };

  export const preview = definePreview<ShareDialogPreviewProps>({
    id: 'share-workspace-dialog',
    title: 'Share workspace dialog (identity seam)',
    defaultState: 'both-connected',
    states: {
      'guest-roles': { props: guestRoles },
      'guest-role-pending': {
        props: { ...guestRoles, pendingRolePrincipalIds: [githubGuest.principalId] },
      },
      'guest-role-error': {
        props: {
          ...guestRoles,
          roleErrors: { [githubGuest.principalId]: 'Could not change this role. Try again.' },
        },
      },
      'guest-roles-unavailable': { props: { ...guestRoles, canSetMemberRole: false } },
      'link-first': { props: { ...sharingSetup, sharingEnabled: true } },
      'link-slow': { props: { ...sharingSetup, sharingEnabled: true, inviteDelayMs: 750 } },
      'sharing-disabled': { props: sharingSetup },
      'sharing-checking': {
        props: { ...sharingSetup, sharingEnabled: null, sharingChecking: true },
      },
      'sharing-enabling': { props: { ...sharingSetup, sharingEnabling: true } },
      'sharing-error': {
        props: {
          ...sharingSetup,
          sharingError:
            'The sharing service is missing. Install Tailcat, restart the app, and try again.',
        },
      },
      'sharing-admin-required': { props: { ...sharingSetup, canAdministerHost: false } },
      'both-connected': { props: bothConnected },
      'gitlab-lab-off': { props: { ...bothConnected, gitlabEnabled: false } },
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

  import type { WorkspaceShareCreatedLink } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  let props: ShareDialogPreviewProps = $props();
  let query = $state('');
  let addedInvites = $state<WorkspaceInvite[]>([]);
  let createdLink = $state<WorkspaceShareCreatedLink | null>(null);
  let creating = $state(false);
  let roleOverrides = $state<Record<string, WorkspaceGuestRole>>({});
  let pendingRolePrincipalIds = $state<string[]>([]);
  const previewUsers = ['alex', 'alexchen', 'alex-k'].map((login, index) => ({
    login,
    githubUserId: index + 1,
    avatarUrl: null,
    htmlUrl: null,
  }));
  const suggestions = $derived(query ? previewUsers : []);
</script>

<div class="relative min-h-[1000px] w-full">
  <ShareWorkspaceDialog
    open
    workspaceId={WORKSPACE_ID}
    workspaceTitle="Polish workspace hover cards"
    gitlabHost={GITLAB_HOST}
    canManage
    guestCount={props.members.length - 1 + addedInvites.length}
    guestLimit={5}
    {...props}
    members={props.members.map((member) => ({
      ...member,
      role: roleOverrides[member.principalId] ?? member.role,
    }))}
    pendingRolePrincipalIds={[...(props.pendingRolePrincipalIds ?? []), ...pendingRolePrincipalIds]}
    onSetMemberRole={async (principalId, role) => {
      pendingRolePrincipalIds = [...pendingRolePrincipalIds, principalId];
      await new Promise((resolve) => setTimeout(resolve, 750));
      roleOverrides = { ...roleOverrides, [principalId]: role };
      pendingRolePrincipalIds = pendingRolePrincipalIds.filter((id) => id !== principalId);
    }}
    invites={[...props.invites, ...addedInvites]}
    {createdLink}
    {creating}
    inviteLinks={Object.fromEntries(
      addedInvites.map((invite) => [invite.id, `intent://invite?preview=${invite.id}`]),
    )}
    userSearchQuery={query}
    userSuggestions={suggestions}
    onSearchUsers={(value) => (query = value)}
    onCreateInvite={async (login, pin) => {
      creating = true;
      // Fixture latency makes the real in-button pending state reviewable.
      if (props.inviteDelayMs)
        await new Promise((resolve) => setTimeout(resolve, props.inviteDelayMs));
      const id = `preview-${addedInvites.length}`;
      const userId = previewUsers.find((user) => user.login === login)?.githubUserId ?? 1;
      addedInvites = [
        ...addedInvites,
        {
          id,
          workspaceId: WORKSPACE_ID,
          createdByPrincipalId: owner.principalId,
          pinLogin: login || undefined,
          pinGithubUserId: login ? userId : undefined,
          pinIdentity: login
            ? {
                provider: pin?.provider ?? 'github',
                host: pin?.host ?? 'github.com',
                externalUserId: String(userId),
              }
            : undefined,
          createdAt: '2026-10-15T00:00:00Z',
          expiresAt: '2099-10-15T00:00:00Z',
          reusable: !login,
        },
      ];
      createdLink = { inviteId: id, pinLogin: login || undefined };
      creating = false;
    }}
    onRevokeInvite={(id) => (addedInvites = addedInvites.filter((invite) => invite.id !== id))}
  />
</div>
