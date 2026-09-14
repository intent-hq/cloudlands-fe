<script lang="ts">
  /**
   * Settings → Guest Sessions (multiplayer w4).
   *
   * Two lists: the workspaces this backend HOSTS for collaborators (owner
   * side — roster + *Remove*, hidden from a collaborator-only client so a
   * guest never sees owner controls) and the hosts this app JOINED as a guest
   * (*Open*, *Leave host*: best-effort `principal.revokeSelf`, then the local
   * delete and window teardown).
   */
  import { Button } from '$lib/components/ui/button';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import HostedWorkspaceRoster from './HostedWorkspaceRoster.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { GuestSessionRecord } from '$shared/types/guest-sessions';
  import { openConnectionRequested } from '$store/renderer/slices/connections/connections-slice';
  import {
    selectGuestSessions,
    selectGuestSessionsConnectedIds,
    selectGuestSessionsLoaded,
    selectGuestSessionsOpenIds,
    selectHostedWorkspaces,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import { leaveGuestSessionRequested } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
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

  function openHost(session: GuestSessionRecord) {
    const action = openConnectionRequested(session.id);
    action.promise.catch(() => {});
    appStore.dispatch(action);
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
            <HostedWorkspaceRoster {workspace} />
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
          <li
            class="flex items-center justify-between gap-3 px-6 py-4"
            data-session-id={session.id}
          >
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
                disabled={leavingId === session.id}
                onclick={() => requestLeave(session)}
              >
                {leavingId === session.id
                  ? m.settings_guestSessions_leaving_label()
                  : m.settings_guestSessions_leave_label()}
              </Button>
            </div>
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

  {#if leaveError}
    <div
      class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
      role="alert"
    >
      <p class="text-sm text-danger">{leaveError}</p>
      <Button
        variant="ghost"
        disabled={!leaveTarget || leavingId !== null}
        onclick={() => leaveHost()}
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
