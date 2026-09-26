<script lang="ts">
  /**
   * ShareWorkspaceDialogHost — Redux host for the owner-side Share dialog
   * (global for every entry point, same pattern as TransferWorkspaceModalHost).
   * Reads the workspace-share slice (target, roster, invites, in-flight
   * mutations) + the GitHub connection flag and forwards every user intent as
   * a dispatch; the dialog stays presentational and the saga owns the RPCs.
   *
   * Invite links are resolved here from the invite-link vault (the store only
   * ever holds invite ids) and handed to the dialog as a plain id → url map.
   *
   * The pin typeahead reads the github-user-search slice and dispatches the
   * (saga-debounced) `searchGithubUsers` trigger on every keystroke.
   */

  import ShareWorkspaceDialog from './ShareWorkspaceDialog.svelte';
  import { readInviteLink } from '$features/workspace-sharing/invite-link-vault';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeShareDialog,
    shareInviteCreateRequested,
    shareInviteRevokeRequested,
    shareMemberAddRequested,
    shareMemberRemoveRequested,
  } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  import {
    selectShareActionError,
    selectShareAddingPrincipalId,
    selectShareCanManage,
    selectShareCreatedLink,
    selectShareCreateError,
    selectShareCreating,
    selectShareDialogOpen,
    selectShareGuestCount,
    selectShareGuestLimit,
    selectShareInvitablePrincipals,
    selectShareInvites,
    selectShareLoadError,
    selectShareLoading,
    selectShareMembers,
    selectShareRemovingPrincipalId,
    selectShareRevokingInviteId,
    selectShareWorkspaceId,
    selectShareWorkspaceTitle,
  } from '$store/renderer/slices/workspace-share/workspace-share-selectors';
  import { selectGitHubAuthIsAuthenticated } from '$store/renderer/slices/github-auth/github-auth-selectors';
  import {
    selectGitLabAuthHost,
    selectGitLabAuthIsConfigured,
  } from '$store/renderer/slices/gitlab-auth/gitlab-auth-selectors';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import { selectEffectiveIdentityProvider } from '$store/renderer/slices/identity/identity-selectors';
  import { selectDaemonSupportsIdentitySeam } from '$store/renderer/slices/daemon-health/daemon-health-selectors';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { searchGithubUsers } from '$store/renderer/slices/github-user-search/github-user-search-slice';
  import {
    selectGithubUserSearchError,
    selectGithubUserSearchLastQuery,
    selectGithubUserSearchLoading,
    selectGithubUserSearchResults,
  } from '$store/renderer/slices/github-user-search/github-user-search-selectors';
  import { openGitHubAuthModal } from '$store/renderer/slices/global-modals/global-modals-slice';

  const open$ = selectShareDialogOpen();
  const workspaceId$ = selectShareWorkspaceId();
  const workspaceTitle$ = selectShareWorkspaceTitle();
  const githubConnected$ = selectGitHubAuthIsAuthenticated();
  const gitlabEnabled$ = selectLabsGitLabEnabled();
  const gitlabConnected$ = selectGitLabAuthIsConfigured();
  const gitlabHost$ = selectGitLabAuthHost();
  const identitySeamSupported$ = selectDaemonSupportsIdentitySeam();
  const identityProvider$ = selectEffectiveIdentityProvider();
  const canManage$ = selectShareCanManage();
  const members$ = selectShareMembers();
  const invites$ = selectShareInvites();
  const principals$ = selectShareInvitablePrincipals();
  const guestCount$ = selectShareGuestCount();
  const guestLimit$ = selectShareGuestLimit();
  const loading$ = selectShareLoading();
  const loadError$ = selectShareLoadError();
  const creating$ = selectShareCreating();
  const createError$ = selectShareCreateError();
  const createdLink$ = selectShareCreatedLink();
  const revokingInviteId$ = selectShareRevokingInviteId();
  const removingPrincipalId$ = selectShareRemovingPrincipalId();
  const addingPrincipalId$ = selectShareAddingPrincipalId();
  const actionError$ = selectShareActionError();
  const userSuggestions$ = selectGithubUserSearchResults();
  const userSearchLoading$ = selectGithubUserSearchLoading();
  const userSearchError$ = selectGithubUserSearchError();
  const userSearchQuery$ = selectGithubUserSearchLastQuery();
  const inviteLinks = $derived.by(() => {
    const ids = $invites$.map((invite) => invite.id);
    if ($createdLink$) ids.push($createdLink$.inviteId);
    const links: Record<string, string> = {};
    for (const id of ids) {
      const url = readInviteLink(id);
      if (url) links[id] = url;
    }
    return links;
  });
</script>

<ShareWorkspaceDialog
  open={$open$}
  workspaceId={$workspaceId$}
  workspaceTitle={$workspaceTitle$}
  githubConnected={$githubConnected$}
  gitlabConnected={$gitlabConnected$}
  gitlabEnabled={$gitlabEnabled$}
  gitlabHost={$gitlabHost$}
  identitySeamSupported={$identitySeamSupported$}
  identityProvider={$identityProvider$}
  canManage={$canManage$}
  members={$members$}
  invites={$invites$}
  principals={$principals$}
  {inviteLinks}
  guestCount={$guestCount$}
  guestLimit={$guestLimit$}
  loading={$loading$}
  loadError={$loadError$}
  creating={$creating$}
  createError={$createError$}
  createdLink={$createdLink$}
  revokingInviteId={$revokingInviteId$}
  removingPrincipalId={$removingPrincipalId$}
  addingPrincipalId={$addingPrincipalId$}
  actionError={$actionError$}
  userSuggestions={$userSuggestions$}
  userSearchLoading={$userSearchLoading$}
  userSearchError={$userSearchError$}
  userSearchQuery={$userSearchQuery$}
  onClose={() => appStore.dispatch(closeShareDialog())}
  onConnectGitHub={() => appStore.dispatch(openGitHubAuthModal(null))}
  onOpenConnections={() => {
    appStore.dispatch(closeShareDialog());
    void navigateToSettings({ tab: 'connections', hash: 'integrations' }).catch(() => {});
  }}
  onCreateInvite={(pinLogin, pin) =>
    appStore.dispatch(shareInviteCreateRequested(pin ? { pinLogin, pin } : { pinLogin }))}
  onRevokeInvite={(inviteId) => appStore.dispatch(shareInviteRevokeRequested(inviteId))}
  onRemoveMember={(principalId) => appStore.dispatch(shareMemberRemoveRequested(principalId))}
  onAddMember={(principalId) => appStore.dispatch(shareMemberAddRequested(principalId))}
  onSearchUsers={(query) => appStore.dispatch(searchGithubUsers(query))}
/>
