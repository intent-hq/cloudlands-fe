<script lang="ts">
  /**
   * Owner-side roster of one shared workspace (multiplayer w4): the accepted
   * members from `workspace.members.list`, each collaborator with a *Remove*
   * that calls `workspace.members.remove`. The owner row never carries a
   * control (`workspace.members.remove` refuses the owner).
   */
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
  import {
    selectHostedRoster,
    selectHostedRemovingPrincipalIds,
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
  }

  let { workspace }: Props = $props();

  const roster$ = selectHostedRoster(workspace.id);
  const removingIds$ = selectHostedRemovingPrincipalIds(workspace.id);

  let removeTarget = $state<WorkspaceMember | null>(null);
  let removeDialogOpen = $state(false);
  let removeError = $state<string | null>(null);

  function memberLabel(member: WorkspaceMember): string {
    return member.displayName ?? member.login ?? member.principalId;
  }

  function requestRemove(member: WorkspaceMember) {
    removeTarget = member;
    removeError = null;
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

  async function removeMember(member = removeTarget) {
    if (!member) return;
    removeError = null;
    try {
      const action = removeHostedMemberRequested(workspace.id, member.principalId);
      appStore.dispatch(action);
      await action.promise;
      removeTarget = null;
    } catch (error) {
      if (!isRetryable(error)) {
        removeTarget = null;
        return;
      }
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
  <h3 class="text-sm font-medium text-foreground">{workspace.title}</h3>
  {#if $roster$.status === 'loading' && $roster$.members.length === 0}
    <p class="mt-2 text-sm text-muted-foreground" role="status">
      {m.settings_guestSessions_roster_loading_label()}
    </p>
  {:else if $roster$.status === 'withheld'}
    <p
      class="mt-2 text-sm text-muted-foreground"
      role="status"
      data-testid="hosted-roster-withheld"
    >
      {m.settings_guestSessions_roster_withheld()}
    </p>
  {:else if $roster$.status === 'error' && $roster$.members.length === 0}
    <p class="mt-2 text-sm text-danger" role="alert">
      {m.settings_guestSessions_roster_error()}
    </p>
  {:else}
    <ul class="mt-2 divide-y divide-border">
      {#each $roster$.members as member (member.principalId)}
        <li class="flex items-center justify-between gap-3 py-2">
          <div class="min-w-0">
            <p class="truncate text-sm text-foreground">{memberLabel(member)}</p>
            <p class="truncate text-xs text-muted-foreground">
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
        </li>
      {/each}
    </ul>
  {/if}
  {#if removeError}
    <div
      class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="text-sm text-danger">{removeError}</p>
      <Button
        variant="ghost"
        disabled={!removeTarget || $removingIds$.includes(removeTarget.principalId)}
        onclick={() => removeMember()}
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
  onConfirm={() => removeMember()}
/>
