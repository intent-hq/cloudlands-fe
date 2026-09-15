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
   *
   * Every failure keeps a *Retry* bound to the CONFIRMED operation that
   * failed — never to whatever the confirm dialog last showed: opening or
   * cancelling another dialog while an operation is pending must not retarget
   * its retry (a cancelled confirmation sends nothing, ever). A confirmation
   * closes its dialog at once (the in-flight state shows on the row), so a
   * late settlement never closes a dialog opened for something else. The *Remove all
   * guests* report lives here rather than in the roster row so a sweep whose
   * membership delta drops the row from *Shared by me* mid-flight still
   * reports each failed step, with its retry, until dismissed by a retry.
   */
  import { Button } from '$lib/components/ui/button';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import HostedWorkspaceRoster from './HostedWorkspaceRoster.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { Workspace } from '$shared/types';
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
    removeAllHostedGuestsRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import type {
    RemoveAllHostedGuestsResult,
    WorkspaceMember,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-types';
  import { selectIsCollaboratorOnlyClient } from '$store/renderer/slices/workspace/workspace-selectors';
  import { store as appStore } from '$store/renderer/store';

  const sessions$ = selectGuestSessions();
  const openIds$ = selectGuestSessionsOpenIds();
  const connectedIds$ = selectGuestSessionsConnectedIds();
  const loaded$ = selectGuestSessionsLoaded();
  const hosted$ = selectHostedWorkspaces();
  const isCollaboratorOnly$ = selectIsCollaboratorOnlyClient();

  /** What the *Leave host* confirm dialog shows — never what a retry acts on. */
  let leaveTarget = $state<GuestSessionRecord | null>(null);
  let leaveDialogOpen = $state(false);
  let openError = $state<string | null>(null);
  /**
   * The confirmed leaves that failed, keyed by session id; each retry re-runs
   * exactly its own. Leaves of different hosts are independent operations, so
   * one in flight never blocks or drops another and each failure keeps its
   * own retry.
   */
  let failedLeaves = $state<Record<string, GuestSessionRecord>>({});
  let leavingIds = $state<string[]>([]);

  function requestLeave(session: GuestSessionRecord) {
    leaveTarget = session;
    leaveDialogOpen = true;
  }

  function dropFailedLeave(id: string) {
    const { [id]: _dropped, ...rest } = failedLeaves;
    failedLeaves = rest;
  }

  async function leaveHost(session: GuestSessionRecord | null) {
    if (!session || leavingIds.includes(session.id)) return;
    leavingIds = [...leavingIds, session.id];
    dropFailedLeave(session.id);
    try {
      const action = leaveGuestSessionRequested(session.id);
      appStore.dispatch(action);
      await action.promise;
    } catch {
      failedLeaves = { ...failedLeaves, [session.id]: session };
    } finally {
      leavingIds = leavingIds.filter((id) => id !== session.id);
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

  /** What the per-workspace *Leave* confirm dialog shows — never what a retry acts on. */
  let leaveWorkspaceTarget = $state<LeaveWorkspaceTarget | null>(null);
  let leaveWorkspaceDialogOpen = $state(false);
  /**
   * The confirmed per-workspace leaves that failed, keyed by
   * `${sessionId}:${workspaceId}`; each retry re-runs exactly its own. As with
   * hosts, leaves of different workspaces are independent: one in flight
   * never blocks or drops another.
   */
  let failedLeaveWorkspaces = $state<Record<string, LeaveWorkspaceTarget>>({});
  let leavingWorkspaceKeys = $state<string[]>([]);

  function workspaceKey(target: LeaveWorkspaceTarget): string {
    return `${target.session.id}:${target.workspace.id}`;
  }

  function requestLeaveWorkspace(session: GuestSessionRecord, workspace: GuestWorkspaceRef) {
    leaveWorkspaceTarget = { session, workspace };
    leaveWorkspaceDialogOpen = true;
  }

  function dropFailedLeaveWorkspace(key: string) {
    const { [key]: _dropped, ...rest } = failedLeaveWorkspaces;
    failedLeaveWorkspaces = rest;
  }

  async function leaveWorkspace(target: LeaveWorkspaceTarget | null) {
    if (!target) return;
    const key = workspaceKey(target);
    if (leavingWorkspaceKeys.includes(key)) return;
    leavingWorkspaceKeys = [...leavingWorkspaceKeys, key];
    dropFailedLeaveWorkspace(key);
    try {
      const action = leaveGuestWorkspaceRequested(target.session.id, target.workspace.id);
      appStore.dispatch(action);
      await action.promise;
    } catch {
      failedLeaveWorkspaces = { ...failedLeaveWorkspaces, [key]: target };
    } finally {
      leavingWorkspaceKeys = leavingWorkspaceKeys.filter((k) => k !== key);
    }
  }

  /**
   * A *Remove all guests* sweep that did not fully succeed, keyed by
   * workspace: the workspace as confirmed (its row may be gone by now), the
   * roster as it was before the sweep (to name a member the sweep could not
   * remove), and one line per failed step (none when the sweep could not run
   * at all). Kept until its retry runs, independently of *Shared by me*.
   */
  interface RemoveAllReport {
    workspace: Workspace;
    membersBefore: WorkspaceMember[];
    failures: string[];
  }

  let removeAllReports = $state<Record<string, RemoveAllReport>>({});
  let sweepingWorkspaceIds = $state<string[]>([]);

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

  function dropRemoveAllReport(workspaceId: string) {
    const { [workspaceId]: _dropped, ...rest } = removeAllReports;
    removeAllReports = rest;
  }

  async function removeAllGuests(workspace: Workspace, membersBefore: WorkspaceMember[]) {
    if (sweepingWorkspaceIds.includes(workspace.id)) return;
    sweepingWorkspaceIds = [...sweepingWorkspaceIds, workspace.id];
    dropRemoveAllReport(workspace.id);
    let failures: string[] | null = null;
    try {
      const action = removeAllHostedGuestsRequested(workspace.id);
      appStore.dispatch(action);
      const result = await action.promise;
      const lines = removeAllFailureLines(result, membersBefore);
      if (lines.length > 0) failures = lines;
    } catch {
      failures = [];
    } finally {
      sweepingWorkspaceIds = sweepingWorkspaceIds.filter((id) => id !== workspace.id);
    }
    if (failures !== null) {
      removeAllReports = {
        ...removeAllReports,
        [workspace.id]: { workspace, membersBefore, failures },
      };
    }
  }
</script>

<div class="space-y-8" data-testid="guest-sessions-settings">
  <div>
    <h2 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_guestSessions_title()}
    </h2>
    <p class="max-w-2xl text-sm text-muted-foreground">
      {m.settings_guestSessions_description()}
    </p>
  </div>

  {#if !$isCollaboratorOnly$}
    <div data-testid="guest-sessions-hosting">
      <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
        {m.settings_guestSessions_hosting_title()}
      </h3>
      {#if $hosted$.length > 0}
        <div class="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
          {#each $hosted$ as workspace (workspace.id)}
            <HostedWorkspaceRoster
              {workspace}
              onRemoveAll={(membersBefore) => removeAllGuests(workspace, membersBefore)}
            />
          {/each}
        </div>
      {:else}
        <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <p class="text-sm font-medium text-foreground">
            {m.settings_guestSessions_hosting_empty_title()}
          </p>
          <p class="mt-1 text-sm text-muted-foreground">
            {m.settings_guestSessions_hosting_empty_description()}
          </p>
        </div>
      {/if}
      {#each Object.values(removeAllReports) as report (report.workspace.id)}
        <div
          class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
          role="alert"
          data-testid="hosted-roster-remove-all-error"
          data-workspace-id={report.workspace.id}
        >
          <div class="min-w-0 text-sm text-danger">
            <p>
              {m.settings_guestSessions_removeAll_error({ workspace: report.workspace.title })}
            </p>
            {#if report.failures.length > 0}
              <ul class="mt-1 space-y-1">
                {#each report.failures as line, index (index)}
                  <li>{line}</li>
                {/each}
              </ul>
            {/if}
          </div>
          <Button
            variant="ghost"
            disabled={sweepingWorkspaceIds.includes(report.workspace.id)}
            onclick={() => removeAllGuests(report.workspace, report.membersBefore)}
          >
            {m.settings_guestSessions_retry_label()}
          </Button>
        </div>
      {/each}
    </div>
  {/if}

  <div data-testid="guest-sessions-joined">
    <h3 class="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {m.settings_guestSessions_joined_title()}
    </h3>
    {#if !$loaded$}
      <p
        class="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground"
        role="status"
      >
        {m.settings_guestSessions_loading_label()}
      </p>
    {:else if $sessions$.length > 0}
      <ul class="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
        {#each $sessions$ as session (session.id)}
          {@const open = $openIds$.includes(session.id)}
          {@const connected = open && $connectedIds$.includes(session.id)}
          <li class="px-6 py-4" data-session-id={session.id}>
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="truncate text-sm text-foreground">{session.label}</p>
                <p class="truncate text-xs text-muted-foreground">
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
                  disabled={leavingIds.includes(session.id)}
                  onclick={() => requestLeave(session)}
                >
                  {leavingIds.includes(session.id)
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
                    <p class="min-w-0 truncate text-sm text-foreground">{workspace.title}</p>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={leavingWorkspaceKeys.includes(key)}
                      onclick={() => requestLeaveWorkspace(session, workspace)}
                    >
                      {leavingWorkspaceKeys.includes(key)
                        ? m.settings_guestSessions_leaving_label()
                        : m.settings_guestSessions_leaveWorkspace_label()}
                    </Button>
                  </li>
                {/each}
              </ul>
            {:else}
              <p class="mt-2 ml-3 text-xs text-muted-foreground">
                {m.settings_guestSessions_workspaces_empty_label()}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <p class="text-sm font-medium text-foreground">
          {m.settings_guestSessions_joined_empty_title()}
        </p>
        <p class="mt-1 text-sm text-muted-foreground">
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
      <p class="text-sm text-danger">{openError}</p>
    </div>
  {/if}

  {#each Object.values(failedLeaves) as failed (failed.id)}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
      data-testid="guest-leave-error"
      data-session-id={failed.id}
    >
      <p class="text-sm text-danger">
        {m.settings_guestSessions_leave_error({ name: failed.label })}
      </p>
      <Button
        variant="ghost"
        disabled={leavingIds.includes(failed.id)}
        onclick={() => leaveHost(failed)}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/each}

  {#each Object.entries(failedLeaveWorkspaces) as [key, failed] (key)}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
      data-testid="guest-leave-workspace-error"
      data-workspace-id={failed.workspace.id}
    >
      <p class="text-sm text-danger">
        {m.settings_guestSessions_leaveWorkspace_error({ workspace: failed.workspace.title })}
      </p>
      <Button
        variant="ghost"
        disabled={leavingWorkspaceKeys.includes(key)}
        onclick={() => leaveWorkspace(failed)}
      >
        {m.settings_guestSessions_retry_label()}
      </Button>
    </div>
  {/each}
</div>

<BulkActionConfirmDialog
  bind:open={leaveDialogOpen}
  title={m.settings_guestSessions_leaveConfirm_title()}
  description={m.settings_guestSessions_leaveConfirm_description({
    name: leaveTarget?.label ?? '',
  })}
  confirmText={m.settings_guestSessions_leave_label()}
  variant="destructive"
  onConfirm={() => void leaveHost(leaveTarget)}
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
  onConfirm={() => void leaveWorkspace(leaveWorkspaceTarget)}
/>
