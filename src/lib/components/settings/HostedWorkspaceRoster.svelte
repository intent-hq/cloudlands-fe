<script lang="ts">
  /**
   * Owner-side roster of one shared workspace (multiplayer w4): the accepted
   * members from `workspace.members.list`, each collaborator with a *Remove*
   * that calls `workspace.members.remove`, plus a per-workspace *Remove all
   * guests* that removes every collaborator and revokes every open invite
   * link (`workspace.invite.list` → `workspace.invite.revoke`). Both confirm
   * first. The confirmed sweep is handed to the parent (`onRemoveAll`, with
   * the roster as it stands) — the sweep's membership delta may unmount this
   * row before it settles, and its per-step report must outlive the row. The
   * owner row never carries a control (`workspace.members.remove` refuses
   * the owner).
   */
  import { onMount } from 'svelte';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import {
    selectHostedRoster,
    selectHostedRemovingPrincipalIds,
    selectIsHostedWorkspaceClearing,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    loadHostedRosterRequested,
    removeHostedMemberRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    HostedRosterOperationError,
    type WorkspaceMember,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspace: Workspace;
    /** A confirmed *Remove all guests*, with the roster as it was before the sweep. */
    onRemoveAll: (membersBefore: WorkspaceMember[]) => void;
  }

  let { workspace, onRemoveAll }: Props = $props();

  const roster$ = selectHostedRoster(workspace.id);
  const removingIds$ = selectHostedRemovingPrincipalIds(workspace.id);
  const clearing$ = selectIsHostedWorkspaceClearing(workspace.id);

  /** What the *Remove* confirm dialog shows — never what a retry acts on. */
  let removeTarget = $state<WorkspaceMember | null>(null);
  let removeDialogOpen = $state(false);
  /** The confirmed removal that failed; its retry re-runs exactly this one. */
  let failedRemove = $state<WorkspaceMember | null>(null);
  let removeError = $state<string | null>(null);

  let removeAllDialogOpen = $state(false);

  function memberLabel(member: WorkspaceMember): string {
    return member.displayName ?? member.login ?? member.principalId;
  }

  function removeAllGuests() {
    if ($clearing$) return;
    onRemoveAll($roster$.members);
  }

  function requestRemove(member: WorkspaceMember) {
    removeTarget = member;
    removeDialogOpen = true;
  }

  /**
   * A retry is offered only for a failure a retry can fix. `forbidden` has
   * terminally moved the roster to `withheld` (the controls are gone) and
   * `cancelled` means the workspace left this window or the same removal is
   * already in flight — neither has anything to retry.
   */
  function isRetryable(error: unknown): boolean {
    return !(
      error instanceof HostedRosterOperationError &&
      (error.code === 'forbidden' || error.code === 'cancelled')
    );
  }

  async function removeMember(member: WorkspaceMember | null) {
    if (!member) return;
    failedRemove = null;
    removeError = null;
    try {
      const action = removeHostedMemberRequested(workspace.id, member.principalId);
      appStore.dispatch(action);
      await action.promise;
    } catch (error) {
      if (!isRetryable(error)) return;
      failedRemove = member;
      removeError = m.settings_guestSessions_remove_error({ name: memberLabel(member) });
    }
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
      items={$roster$.members}
      getKey={(member) => member.principalId}
      getText={(member) => memberLabel(member)}
      ariaLabel={workspace.title}
      class="mt-2 overflow-visible"
    >
      {#snippet row({ item: member })}
        <div class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <p class="truncate type-body text-foreground">{memberLabel(member)}</p>
            <p class="truncate type-caption text-muted-foreground">
              {member.role === 'owner'
                ? m.settings_guestSessions_role_owner_label()
                : m.settings_guestSessions_role_collaborator_label()}
              {#if member.login && member.displayName}
                · @{member.login}
              {/if}
            </p>
          </div>
          {#if member.role !== 'owner'}
            <Button
              variant="ghost"
              size="sm"
              disabled={$removingIds$.includes(member.principalId)}
              onclick={() => requestRemove(member)}
            >
              {m.settings_guestSessions_remove_label()}
            </Button>
          {/if}
        </div>
      {/snippet}
    </ListView>
  {/if}
  {#if removeError}
    <div
      class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="type-body text-danger">{removeError}</p>
      <Button
        variant="ghost"
        disabled={!failedRemove || $removingIds$.includes(failedRemove.principalId)}
        onclick={() => removeMember(failedRemove)}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/if}
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
