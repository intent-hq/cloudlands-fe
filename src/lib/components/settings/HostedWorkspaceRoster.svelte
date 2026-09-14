<script lang="ts">
  /**
   * Owner-side roster of one shared workspace (multiplayer w4): the accepted
   * members from `workspace.members.list`, each collaborator with a *Remove*
   * that calls `workspace.members.remove`, plus a per-workspace *Remove all
   * guests* that removes every collaborator and revokes every open invite
   * link (`workspace.invite.list` → `workspace.invite.revoke`), reporting
   * each step that failed. Both confirm first. The owner row never carries a
   * control (`workspace.members.remove` refuses the owner).
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
    removeAllHostedGuestsRequested,
    removeHostedMemberRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    HostedRosterOperationError,
    type RemoveAllHostedGuestsResult,
    type WorkspaceMember,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    workspace: Workspace;
  }

  let { workspace }: Props = $props();

  const roster$ = selectHostedRoster(workspace.id);
  const removingIds$ = selectHostedRemovingPrincipalIds(workspace.id);
  const clearing$ = selectIsHostedWorkspaceClearing(workspace.id);

  let removeTarget = $state<WorkspaceMember | null>(null);
  let removeDialogOpen = $state(false);
  let removeError = $state<string | null>(null);

  let removeAllDialogOpen = $state(false);
  let removeAllError = $state<string | null>(null);
  let removeAllFailures = $state<string[]>([]);

  function memberLabel(member: WorkspaceMember): string {
    return member.displayName ?? member.login ?? member.principalId;
  }

  function removeAllFailureLines(
    result: RemoveAllHostedGuestsResult,
    membersBefore: WorkspaceMember[],
  ): string[] {
    const lines = result.failedMembers.map(({ principalId }) => {
      const member = membersBefore.find((entry) => entry.principalId === principalId);
      return m.settings_guestSessions_remove_error({
        name: member ? memberLabel(member) : principalId,
      });
    });
    for (const { pinLogin } of result.failedInvites) {
      lines.push(
        pinLogin
          ? m.settings_guestSessions_removeAll_pinnedInviteFailed({ login: `@${pinLogin}` })
          : m.settings_guestSessions_removeAll_inviteFailed(),
      );
    }
    if (result.invitesUnavailable) {
      lines.push(m.settings_guestSessions_removeAll_invitesUnavailable());
    }
    return lines;
  }

  function requestRemoveAll() {
    removeAllError = null;
    removeAllFailures = [];
    removeAllDialogOpen = true;
  }

  async function removeAllGuests() {
    if ($clearing$) return;
    removeAllError = null;
    removeAllFailures = [];
    const membersBefore = $roster$.members;
    try {
      const action = removeAllHostedGuestsRequested(workspace.id);
      appStore.dispatch(action);
      const result = await action.promise;
      removeAllFailures = removeAllFailureLines(result, membersBefore);
    } catch {
      removeAllError = m.settings_guestSessions_removeAll_error({ workspace: workspace.title });
    }
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
  <div class="flex items-center justify-between gap-3">
    <h3 class="min-w-0 truncate type-body font-medium text-foreground">{workspace.title}</h3>
    {#if $roster$.status !== 'withheld'}
      <Button
        variant="ghost"
        size="sm"
        class="shrink-0"
        disabled={$clearing$}
        onclick={requestRemoveAll}
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
        disabled={!removeTarget || $removingIds$.includes(removeTarget.principalId)}
        onclick={() => removeMember()}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/if}
  {#if removeAllError || removeAllFailures.length > 0}
    <div
      class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
      data-testid="hosted-roster-remove-all-error"
    >
      <div class="min-w-0 type-body text-danger">
        {#if removeAllError}
          <p>{removeAllError}</p>
        {:else}
          <ul class="space-y-1">
            {#each removeAllFailures as line, index (index)}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
      </div>
      <Button variant="ghost" disabled={$clearing$} onclick={() => removeAllGuests()}>
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

<BulkActionConfirmDialog
  bind:open={removeAllDialogOpen}
  title={m.settings_guestSessions_removeAllConfirm_title()}
  description={m.settings_guestSessions_removeAllConfirm_description({
    workspace: workspace.title,
  })}
  confirmText={m.settings_guestSessions_removeAll_label()}
  variant="destructive"
  onConfirm={() => removeAllGuests()}
/>
