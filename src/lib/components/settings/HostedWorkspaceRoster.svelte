<script lang="ts">
  /**
   * Owner-side roster of one shared workspace (multiplayer w4): the accepted
   * members from `workspace.members.list`, each collaborator with a *Remove*
   * that calls `workspace.members.remove`, plus a per-workspace *Remove all
   * guests* that removes every collaborator and revokes every open invite
   * link (`workspace.invite.list` → `workspace.invite.revoke`). Both confirm
   * first. The confirmed sweep is handed to the parent (`onRemoveAll`) — its
   * membership delta may unmount this row before it settles, so the saga
   * captures the roster and retains its report in the slice. The
   * owner is not listed (`workspace.members.remove` refuses the owner); only
   * the displayed rows are filtered — the sweep still receives the full roster.
   */
  import { onMount } from 'svelte';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button, PrincipalAvatar } from '$lib/components/patterns/settings/custom-controls';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import {
    selectHostedRoster,
    selectHostedRemovingPrincipalIds,
    selectIsHostedWorkspaceClearing,
    selectHostedFailedRemovals,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    loadHostedRosterRequested,
    removeHostedMemberRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import type { WorkspaceMember } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspace: Workspace;
    /** A confirmed *Remove all guests*. The saga captures the current roster. */
    onRemoveAll: () => void;
  }

  let { workspace, onRemoveAll }: Props = $props();

  const roster$ = selectHostedRoster(workspace.id);
  const removingIds$ = selectHostedRemovingPrincipalIds(workspace.id);
  const clearing$ = selectIsHostedWorkspaceClearing(workspace.id);
  const failedRemovals$ = selectHostedFailedRemovals(workspace.id);

  const collaborators = $derived($roster$.members.filter((member) => member.role !== 'owner'));

  /** What the *Remove* confirm dialog shows — never what a retry acts on. */
  let removeTarget = $state<WorkspaceMember | null>(null);
  let removeDialogOpen = $state(false);

  let removeAllDialogOpen = $state(false);

  function memberLabel(member: WorkspaceMember): string {
    return member.displayName ?? member.login ?? member.principalId;
  }

  function removeAllGuests() {
    if ($clearing$) return;
    onRemoveAll();
  }

  function requestRemove(member: WorkspaceMember) {
    removeTarget = member;
    removeDialogOpen = true;
  }

  function removeMember(member: WorkspaceMember | null) {
    if (!member) return;
    const action = removeHostedMemberRequested(workspace.id, member.principalId);
    action.promise.catch(() => {});
    appStore.dispatch(action);
  }

  onMount(() => {
    const action = loadHostedRosterRequested(workspace.id);
    action.promise.catch(() => {});
    appStore.dispatch(action);
  });
</script>

<section class="px-6 py-5" data-testid="hosted-workspace-roster" data-workspace-id={workspace.id}>
  <div class="flex items-center justify-between gap-3">
    <h3 class="min-w-0 truncate type-body font-medium text-foreground">{workspace.title}</h3>
    {#if $roster$.status !== 'withheld'}
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0"
        disabled={$clearing$}
        onclick={() => (removeAllDialogOpen = true)}
        data-testid="hosted-roster-remove-all"
      >
        {$clearing$
          ? m.settings_guestSessions_removingAll_label()
          : m.settings_guestSessions_removeAll_label()}
      </Button>
    {/if}
  </div>
  {#if $roster$.status === 'loading' && $roster$.members.length === 0}
    <p class="mt-2 type-body text-muted-foreground" role="status">
      {m.settings_guestSessions_roster_loading_label()}
    </p>
  {:else if $roster$.status === 'withheld'}
    <p
      class="mt-2 type-body text-muted-foreground"
      role="status"
      data-testid="hosted-roster-withheld"
    >
      {m.settings_guestSessions_roster_withheld()}
    </p>
  {:else if $roster$.status === 'error' && $roster$.members.length === 0}
    <p class="mt-2 type-body text-danger" role="alert">
      {m.settings_guestSessions_roster_error()}
    </p>
  {:else}
    <ListView
      virtualize={false}
      items={collaborators}
      getKey={(member) => member.principalId}
      getText={(member) => memberLabel(member)}
      ariaLabel={workspace.title}
      class="mt-2 overflow-visible"
    >
      {#snippet row({ item: member })}
        <div class="flex items-center justify-between gap-3 py-2">
          <div class="flex min-w-0 items-center gap-2">
            <PrincipalAvatar
              avatarUrl={member.avatarUrl}
              label={memberLabel(member)}
              size={24}
              testid="hosted-roster-avatar"
            />
            <div class="min-w-0">
              <p class="truncate type-body text-foreground">{memberLabel(member)}</p>
              <p class="truncate type-caption text-muted-foreground">
                {m.settings_guestSessions_role_collaborator_label()}
                {#if member.login && member.displayName}
                  · @{member.login}
                {/if}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={$removingIds$.includes(member.principalId)}
            onclick={() => requestRemove(member)}
          >
            {m.settings_guestSessions_remove_label()}
          </Button>
        </div>
      {/snippet}
    </ListView>
  {/if}
  {#each $failedRemovals$ as failedRemove (failedRemove.principalId)}
    <div
      class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="type-body text-danger">
        {m.settings_guestSessions_remove_error({ name: memberLabel(failedRemove) })}
      </p>
      <Button
        variant="ghost"
        disabled={$removingIds$.includes(failedRemove.principalId)}
        onclick={() => removeMember(failedRemove)}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/each}
</section>

<BulkActionConfirmDialog
  bind:open={removeDialogOpen}
  title={m.settings_guestSessions_removeConfirm_title()}
  description={m.settings_guestSessions_removeConfirm_description({
    name: removeTarget ? memberLabel(removeTarget) : '',
    workspace: workspace.title,
  })}
  confirmText={m.settings_guestSessions_remove_label()}
  variant="destructive"
  onConfirm={() => void removeMember(removeTarget)}
/>

<BulkActionConfirmDialog
  bind:open={removeAllDialogOpen}
  title={m.settings_guestSessions_removeAllConfirm_title()}
  description={m.settings_guestSessions_removeAllConfirm_description({
    workspace: workspace.title,
  })}
  confirmText={m.settings_guestSessions_removeAll_label()}
  variant="destructive"
  onConfirm={removeAllGuests}
/>
