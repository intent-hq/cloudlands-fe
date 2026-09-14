<script lang="ts">
  /**
   * ShareWorkspaceDialogHost — Redux host for the owner-side Share dialog
   * (global for every entry point, same pattern as TransferWorkspaceModalHost).
   * Reads the workspace-share slice (target, roster, invites, in-flight
   * mutations) + the GitHub connection flag and forwards every user intent as
   * a dispatch; the dialog stays presentational and the saga owns the RPCs.
   */

  import ShareWorkspaceDialog from './ShareWorkspaceDialog.svelte';
  import { store as appStore } from '$store/renderer/store';
  import {
    closeShareDialog,
    shareInviteCreateRequested,
    shareInviteRevokeRequested,
    shareMemberRemoveRequested,
  } from '$store/renderer/slices/workspace-share/workspace-share-slice';
  import {
    selectShareActionError,
    selectShareCreatedLink,
    selectShareCreateError,
    selectShareCreating,
    selectShareDialogOpen,
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
  import { openGitHubAuthModal } from '$store/renderer/slices/global-modals/global-modals-slice';

  const open$ = selectShareDialogOpen();
  const workspaceId$ = selectShareWorkspaceId();
  const workspaceTitle$ = selectShareWorkspaceTitle();
  const githubConnected$ = selectGitHubAuthIsAuthenticated();
  const members$ = selectShareMembers();
  const invites$ = selectShareInvites();
  const loading$ = selectShareLoading();
  const loadError$ = selectShareLoadError();
  const creating$ = selectShareCreating();
  const createError$ = selectShareCreateError();
  const createdLink$ = selectShareCreatedLink();
  const revokingInviteId$ = selectShareRevokingInviteId();
  const removingPrincipalId$ = selectShareRemovingPrincipalId();
  const actionError$ = selectShareActionError();
</script>

<ShareWorkspaceDialog
  open={$open$}
  workspaceId={$workspaceId$}
  workspaceTitle={$workspaceTitle$}
  githubConnected={$githubConnected$}
  members={$members$}
  invites={$invites$}
  loading={$loading$}
  loadError={$loadError$}
  creating={$creating$}
  createError={$createError$}
  createdLink={$createdLink$}
  revokingInviteId={$revokingInviteId$}
  removingPrincipalId={$removingPrincipalId$}
  actionError={$actionError$}
  onClose={() => appStore.dispatch(closeShareDialog())}
  onConnectGitHub={() => appStore.dispatch(openGitHubAuthModal(null))}
  onCreateInvite={(pinLogin) => appStore.dispatch(shareInviteCreateRequested({ pinLogin }))}
  onRevokeInvite={(inviteId) => appStore.dispatch(shareInviteRevokeRequested(inviteId))}
  onRemoveMember={(principalId) => appStore.dispatch(shareMemberRemoveRequested(principalId))}
/>
