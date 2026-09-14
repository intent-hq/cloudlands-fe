<script lang="ts">
  /**
   * Settings → Guest Sessions (multiplayer w4).
   *
   * Two lists: the workspaces this backend HOSTS for collaborators (owner
   * side — roster + *Remove* / *Remove all guests*, hidden from a
   * collaborator-only client so a guest never sees owner controls) and the
   * hosts this app JOINED as a guest, each with its joined workspaces nested
   * underneath (*Open*; per-workspace *Leave*: `workspace.members.leave` then
   * the local drop; *Leave host*: best-effort `principal.revokeSelf`, then the
   * local delete and window teardown). Every destructive action confirms.
   */
  import { ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import HostedWorkspaceRoster from './HostedWorkspaceRoster.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { GuestSessionRecord, GuestWorkspaceRef } from '$shared/types/guest-sessions';
  import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import {
    selectGuestSessions,
    selectGuestSessionsConnectedIds,
    selectGuestSessionsLoaded,
    selectGuestSessionsOpenIds,
    selectHostedWorkspaces,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    leaveGuestSessionRequested,
    leaveGuestWorkspaceRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';

  const sessions$ = selectGuestSessions();
  const openIds$ = selectGuestSessionsOpenIds();
  const connectedIds$ = selectGuestSessionsConnectedIds();
  const loaded$ = selectGuestSessionsLoaded();
  const hosted$ = selectHostedWorkspaces();
  const isCollaboratorOnly$ = selectIsCollaboratorOnlyClient();

  let leaveTarget = $state<GuestSessionRecord | null>(null);
  let leaveDialogOpen = $state(false);
  let leaveError = $state<string | null>(null);
  let leavingId = $state<string | null>(null);
  let openError = $state<string | null>(null);

  function requestLeave(session: GuestSessionRecord) {
    leaveTarget = session;
    leaveError = null;
    leaveDialogOpen = true;
  }

  async function leaveHost(session = leaveTarget) {
    if (!session || leavingId) return;
    leavingId = session.id;
    leaveError = null;
    try {
      const action = leaveGuestSessionRequested(session.id);
      appStore.dispatch(action);
      await action.promise;
      leaveTarget = null;
    } catch {
      leaveError = m.settings_guestSessions_leave_error({ name: session.label });
    } finally {
      leavingId = null;
    }
  }

  /**
   * `connections:open` reports an unreadable stored guest token as a resolved
   * `secret-unavailable` (no window opens), not a rejection: surface it here,
   * where the only recovery — leave the host and rejoin from a new invite —
   * sits next to the row.
   */
  async function openHost(session: GuestSessionRecord) {
    openError = null;
    try {
      const action = openConnectionRequested(session.id);
      appStore.dispatch(action);
      const result = await action.promise;
      if (result.status === 'secret-unavailable') {
        openError = m.settings_guestSessions_open_secretUnavailable_error({ name: session.label });
      }
    } catch {
      openError = m.settings_guestSessions_open_error({ name: session.label });
    }
  }

  interface LeaveWorkspaceTarget {
    session: GuestSessionRecord;
    workspace: GuestWorkspaceRef;
  }

  let leaveWorkspaceTarget = $state<LeaveWorkspaceTarget | null>(null);
  let leaveWorkspaceDialogOpen = $state(false);
  let leaveWorkspaceError = $state<string | null>(null);
  let leavingWorkspaceKey = $state<string | null>(null);

  function workspaceKey(target: LeaveWorkspaceTarget): string {
    return `${target.session.id}:${target.workspace.id}`;
  }

  function requestLeaveWorkspace(session: GuestSessionRecord, workspace: GuestWorkspaceRef) {
    leaveWorkspaceTarget = { session, workspace };
    leaveWorkspaceError = null;
    leaveWorkspaceDialogOpen = true;
  }

  async function leaveWorkspace(target = leaveWorkspaceTarget) {
    if (!target || leavingWorkspaceKey) return;
    leavingWorkspaceKey = workspaceKey(target);
    leaveWorkspaceError = null;
    try {
      const action = leaveGuestWorkspaceRequested(target.session.id, target.workspace.id);
      appStore.dispatch(action);
      await action.promise;
      leaveWorkspaceTarget = null;
    } catch {
      leaveWorkspaceError = m.settings_guestSessions_leaveWorkspace_error({
        workspace: target.workspace.title,
      });
    } finally {
      leavingWorkspaceKey = null;
    }
  }
</script>

<div class="space-y-8" data-testid="guest-sessions-settings">
  <div>
    <h2 class="type-title mb-3 text-foreground">
      {m.settings_guestSessions_title()}
    </h2>
    <p class="max-w-2xl type-body text-muted-foreground">
      {m.settings_guestSessions_description()}
    </p>
  </div>

  {#if !$isCollaboratorOnly$}
    <div data-testid="guest-sessions-hosting">
      <h3 class="type-title mb-3 text-foreground">
        {m.settings_guestSessions_hosting_title()}
      </h3>
      {#if $hosted$.length > 0}
        <div class="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
          {#each $hosted$ as workspace (workspace.id)}
            <HostedWorkspaceRoster {workspace} />
          {/each}
        </div>
      {:else}
        <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p class="type-body font-medium text-foreground">
            {m.settings_guestSessions_hosting_empty_title()}
          </p>
          <p class="mt-1 type-body text-muted-foreground">
            {m.settings_guestSessions_hosting_empty_description()}
          </p>
        </div>
      {/if}
    </div>
  {/if}

  <div data-testid="guest-sessions-joined">
    <h3 class="type-title mb-3 text-foreground">
      {m.settings_guestSessions_joined_title()}
    </h3>
    {#if !$loaded$}
      <p
        class="rounded-xl border border-border bg-card p-6 type-body text-muted-foreground"
        role="status"
      >
        {m.settings_guestSessions_loading_label()}
      </p>
    {:else if $sessions$.length > 0}
      <ListView
        virtualize={false}
        items={$sessions$}
        getKey={(session) => session.id}
        getText={(session) => session.label}
        ariaLabel={m.settings_guestSessions_joined_title()}
        class="overflow-visible rounded-xl bg-card"
      >
        {#snippet row({ item: session })}
          {@const open = $openIds$.includes(session.id)}
          {@const connected = open && $connectedIds$.includes(session.id)}
          <div class="px-6 py-4" data-session-id={session.id}>
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate type-body text-foreground">{session.label}</p>
                <p class="truncate type-caption text-muted-foreground">
                  <!-- Status only for a host with a window (pooled client); a
                       joined host that was never opened has no status. -->
                  {#if open}
                    <span data-guest-connected={connected}>
                      {connected
                        ? m.settings_guestSessions_status_connected_label()
                        : m.settings_guestSessions_status_notConnected_label()}
                    </span>
                    ·
                  {/if}
                  @{session.login}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Button variant="ghost" size="sm" onclick={() => openHost(session)}>
                  {m.settings_guestSessions_open_label()}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={leavingId === session.id}
                  onclick={() => requestLeave(session)}
                >
                  {leavingId === session.id
                    ? m.settings_guestSessions_leaving_label()
                    : m.settings_guestSessions_leave_label()}
                </Button>
              </div>
            </div>
            {#if session.workspaces.length > 0}
              <ul
                class="mt-3 ml-3 border-l border-border pl-3 divide-y divide-border"
                aria-label={m.settings_guestSessions_workspaces_ariaLabel({ name: session.label })}
                data-testid="guest-session-workspaces"
              >
                {#each session.workspaces as workspace (workspace.id)}
                  {@const key = `${session.id}:${workspace.id}`}
                  <li
                    class="flex items-center justify-between gap-3 py-2"
                    data-workspace-id={workspace.id}
                  >
                    <p class="min-w-0 truncate type-body text-foreground">{workspace.title}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={leavingWorkspaceKey === key}
                      onclick={() => requestLeaveWorkspace(session, workspace)}
                    >
                      {leavingWorkspaceKey === key
                        ? m.settings_guestSessions_leaving_label()
                        : m.settings_guestSessions_leaveWorkspace_label()}
                    </Button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mt-2 ml-3 type-caption text-muted-foreground">
                {m.settings_guestSessions_workspaces_empty_label()}
              </p>
            {/if}
          </div>
        {/snippet}
      </ListView>
    {:else}
      <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p class="type-body font-medium text-foreground">
          {m.settings_guestSessions_joined_empty_title()}
        </p>
        <p class="mt-1 type-body text-muted-foreground">
          {m.settings_guestSessions_joined_empty_description()}
        </p>
      </div>
    {/if}
  </div>

  {#if openError}
    <div
      class="rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
      data-testid="guest-sessions-open-error"
    >
      <p class="type-body text-danger">{openError}</p>
    </div>
  {/if}

  {#if leaveError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="type-body text-danger">{leaveError}</p>
      <Button
        variant="ghost"
        disabled={!leaveTarget || leavingId !== null}
        onclick={() => leaveHost()}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/if}

  {#if leaveWorkspaceError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
      data-testid="guest-leave-workspace-error"
    >
      <p class="type-body text-danger">{leaveWorkspaceError}</p>
      <Button
        variant="ghost"
        disabled={!leaveWorkspaceTarget || leavingWorkspaceKey !== null}
        onclick={() => leaveWorkspace()}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/if}
</div>

<BulkActionConfirmDialog
  bind:open={leaveDialogOpen}
  title={m.settings_guestSessions_leaveConfirm_title()}
  description={m.settings_guestSessions_leaveConfirm_description({
    name: leaveTarget?.label ?? '',
  })}
  confirmText={m.settings_guestSessions_leave_label()}
  variant="destructive"
  onConfirm={() => leaveHost()}
/>

<BulkActionConfirmDialog
  bind:open={leaveWorkspaceDialogOpen}
  title={m.settings_guestSessions_leaveWorkspaceConfirm_title()}
  description={m.settings_guestSessions_leaveWorkspaceConfirm_description({
    workspace: leaveWorkspaceTarget?.workspace.title ?? '',
    name: leaveWorkspaceTarget?.session.label ?? '',
  })}
  confirmText={m.settings_guestSessions_leaveWorkspace_label()}
  variant="destructive"
  onConfirm={() => leaveWorkspace()}
/>
