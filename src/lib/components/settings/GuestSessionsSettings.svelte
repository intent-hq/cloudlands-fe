<script lang="ts">
  /**
   * Settings → Collaboration.
   *
   * Current-principal identity and owner-only instance sharing precede two
   * workspace lists: the workspaces this backend HOSTS for collaborators (owner
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
   * guests* report lives in the slice rather than in the roster row so a sweep whose
   * membership delta drops the row from *Shared by me* mid-flight still
   * reports each failed step, with its retry, until dismissed by a retry.
   */
  import HostMembershipSettings from '$features/host-membership/HostMembershipSettings.svelte';
  import { selectHostMembershipContext } from '$store/renderer/slices/host-membership/host-membership-selectors';
  import {
    selectPrincipalSnapshot,
    selectCanCreateWorkspace,
    selectHostRole,
    selectCollaborationReady,
    selectPrincipalActionContext,
  } from '$store/renderer/slices/principal/principal-selectors';
  import { defineSettings, SettingsForm, SettingsSection } from '$lib/components/patterns/settings';
  import { ListView } from '$lib/components/patterns/collection';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import HostedWorkspaceRoster from './HostedWorkspaceRoster.svelte';
  import { selectLabsMultiplayerEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  const multiplayer$ = selectLabsMultiplayerEnabled();
  import { formatGuestSessionAddress, formatGuestSessionLabel } from '$lib/utils/connection-label';
  import { m } from '$shared/paraglide/messages.js';
  import type { GuestSessionRecord, GuestWorkspaceRef } from '$shared/types/guest-sessions';
  import { onDestroy } from 'svelte';
  import {
    connectionWorkflowRequested,
    connectionWorkflowCleared,
  } from '$store/renderer/slices/connections/connections-slice';
  import {
    selectConnectionWorkflow,
    selectConnectionsLoaded,
    selectCurrentConnectionId,
  } from '$store/renderer/slices/connections/connections-selectors';
  import { LOCAL_CONNECTION_ID } from '$shared/types/connections';
  import {
    selectGuestSessions,
    selectGuestLeaveConfirmations,
    selectWindowGuestSession,
    selectInheritedWorkspaceKeys,
    selectGuestSessionsConnectedIds,
    selectGuestSessionsLoaded,
    selectGuestSessionsOpenIds,
    selectHostedWorkspaces,
    selectGuestLeavingIds,
    selectGuestLeavingWorkspaceKeys,
    selectGuestFailedLeaves,
    selectGuestFailedWorkspaceLeaves,
    selectHostedSweepReports,
    selectHostedClearingIds,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import {
    collaborationSignInRequested,
    guestLeaveConfirmed,
    leaveGuestSessionRequested,
    leaveGuestWorkspaceRequested,
    removeAllHostedGuestsRequested,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    guestSessionLifetime,
    guestLeaveConfirmationKey,
    type HostedSweepReport,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-types';

  import { store as appStore } from '$store/renderer/store';

  const identitySchema = $derived(
    defineSettings({
      sections: [
        {
          id: 'collaboration-identity-summary',
          title: m.settings_collaboration_identity_title(),
          entries: [
            {
              id: 'collaboration-account',
              kind: 'custom',
              layout: 'full-width',
              label: m.settings_collaboration_identity_title(),
              class: 'px-4',
            },
          ],
        },
      ],
    }),
  );

  const inheritedWorkspaceKeys$ = selectInheritedWorkspaceKeys();
  const sessions$ = selectGuestSessions();
  const currentSession$ = selectWindowGuestSession();
  const hostRole$ = selectHostRole();
  const principal$ = selectPrincipalSnapshot();
  const openIds$ = selectGuestSessionsOpenIds();
  const connectedIds$ = selectGuestSessionsConnectedIds();
  const loaded$ = selectGuestSessionsLoaded();
  const hosted$ = selectHostedWorkspaces();
  const canCreateWorkspace$ = selectCanCreateWorkspace();
  const ready$ = selectCollaborationReady();
  const connectionId$ = selectCurrentConnectionId();
  const connectionsLoaded$ = selectConnectionsLoaded();
  // The sign-in IPC selects identity on the local daemon, never a remote host.
  const localIdentityAction = $derived(
    $connectionsLoaded$ && $connectionId$ === LOCAL_CONNECTION_ID,
  );
  const currentIdentity = $derived($ready$ ? $principal$?.principal.identity : undefined);
  const hostContext$ = selectHostMembershipContext();
  const leavingIds$ = selectGuestLeavingIds();
  const leavingWorkspaceKeys$ = selectGuestLeavingWorkspaceKeys();
  const failedLeaves$ = selectGuestFailedLeaves();
  const failedLeaveWorkspaces$ = selectGuestFailedWorkspaceLeaves();
  const removeAllReports$ = selectHostedSweepReports();
  const sweepingWorkspaceIds$ = selectHostedClearingIds();

  /** The host projects an untitled workspace as `title: ""`; name it as the workspace cards do. */
  function workspaceLabel(workspace: Pick<GuestWorkspaceRef, 'title'>): string {
    return workspace.title.trim() || m.workspace_links_untitled_label();
  }

  /** What the *Leave host* confirm dialog shows — never what a retry acts on. */
  let hostConfirmedContext: string | null = null;
  let workspaceConfirmedContext: string | null = null;
  const confirmations$ = selectGuestLeaveConfirmations();
  function sameSavedSession(session: GuestSessionRecord) {
    return (
      guestSessionLifetime(session) ===
      guestSessionLifetime(
        selectGuestSessions.select(appStore.state).find((current) => current.id === session.id),
      )
    );
  }
  function rememberConfirmation(
    session: GuestSessionRecord,
    workspaceId: string | null,
    context: string | null,
  ) {
    const lifetime = guestSessionLifetime(session);
    if (!context || !lifetime || !sameSavedSession(session)) return false;
    appStore.dispatch(guestLeaveConfirmed({ id: session.id, workspaceId, context, lifetime }));
    return true;
  }
  function canRetry(session: GuestSessionRecord, workspaceId: string | null) {
    const confirmation = $confirmations$[guestLeaveConfirmationKey(session.id, workspaceId)];
    return (
      actionReady() &&
      sameSavedSession(session) &&
      confirmation?.context === selectPrincipalActionContext.select(appStore.state) &&
      confirmation?.lifetime === guestSessionLifetime(session)
    );
  }
  function actionReady() {
    return selectCollaborationReady.select(appStore.state);
  }
  let leaveTarget = $state<GuestSessionRecord | null>(null);
  let leaveDialogOpen = $state(false);
  const consumerId = $props.id();
  const openWorkflow$ = selectConnectionWorkflow(consumerId);
  const openTarget = $derived(
    $sessions$.find((session) => session.id === $openWorkflow$?.targetId),
  );
  const openError = $derived(
    openTarget && $openWorkflow$?.outcome?.kind === 'secretUnavailable'
      ? m.settings_guestSessions_open_secretUnavailable_error({
          name: formatGuestSessionLabel(openTarget),
        })
      : openTarget && $openWorkflow$?.outcome?.kind === 'error'
        ? m.settings_guestSessions_open_error({ name: formatGuestSessionLabel(openTarget) })
        : null,
  );
  onDestroy(() => appStore.dispatch(connectionWorkflowCleared(consumerId)));
  function requestLeave(session: GuestSessionRecord) {
    if (!actionReady()) return;
    hostConfirmedContext = selectPrincipalActionContext.select(appStore.state);
    leaveTarget = session;
    leaveDialogOpen = true;
  }

  function leaveHost(session: GuestSessionRecord | null) {
    if (
      !session ||
      !actionReady() ||
      hostConfirmedContext !== selectPrincipalActionContext.select(appStore.state)
    )
      return;
    if (!rememberConfirmation(session, null, hostConfirmedContext)) return;
    appStore.dispatch(leaveGuestSessionRequested(session.id));
  }

  /**
   * `connections:open` reports an unreadable stored guest token as a resolved
   * `secret-unavailable` (no window opens), not a rejection: surface it here,
   * where the only recovery — leave the host and rejoin from a new invite —
   * sits next to the row.
   */
  function openHost(session: GuestSessionRecord) {
    if (!actionReady()) return;
    appStore.dispatch(connectionWorkflowRequested(consumerId, { kind: 'open', id: session.id }));
  }

  interface LeaveWorkspaceTarget {
    session: GuestSessionRecord;
    workspace: GuestWorkspaceRef;
  }

  /** What the per-workspace *Leave* confirm dialog shows — never what a retry acts on. */
  let leaveWorkspaceTarget = $state<LeaveWorkspaceTarget | null>(null);
  let leaveWorkspaceDialogOpen = $state(false);
  function workspaceKey(target: LeaveWorkspaceTarget): string {
    return `${target.session.id}:${target.workspace.id}`;
  }

  function requestLeaveWorkspace(session: GuestSessionRecord, workspace: GuestWorkspaceRef) {
    if (!actionReady()) return;
    workspaceConfirmedContext = selectPrincipalActionContext.select(appStore.state);
    leaveWorkspaceTarget = { session, workspace };
    leaveWorkspaceDialogOpen = true;
  }

  function leaveWorkspace(target: LeaveWorkspaceTarget | null) {
    if (
      !target ||
      !actionReady() ||
      workspaceConfirmedContext !== selectPrincipalActionContext.select(appStore.state)
    )
      return;
    if (!rememberConfirmation(target.session, target.workspace.id, workspaceConfirmedContext))
      return;
    appStore.dispatch(leaveGuestWorkspaceRequested(target.session.id, target.workspace.id));
  }

  function retryHost(session: GuestSessionRecord) {
    if (canRetry(session, null)) appStore.dispatch(leaveGuestSessionRequested(session.id));
    else requestLeave(session);
  }
  function retryWorkspace(target: LeaveWorkspaceTarget) {
    if (canRetry(target.session, target.workspace.id))
      appStore.dispatch(leaveGuestWorkspaceRequested(target.session.id, target.workspace.id));
    else requestLeaveWorkspace(target.session, target.workspace);
  }

  function removeAllFailureLines(report: HostedSweepReport): string[] {
    const lines = report.failedMemberIds.map((principalId) =>
      m.settings_guestSessions_remove_error({
        name: report.memberLabels[principalId] ?? principalId,
      }),
    );
    for (const pinLogin of report.failedInviteLabels) {
      lines.push(
        pinLogin
          ? m.settings_guestSessions_removeAll_pinnedInviteFailed({ login: `@${pinLogin}` })
          : m.settings_guestSessions_removeAll_inviteFailed(),
      );
    }
    if (report.invitesUnavailable) {
      lines.push(m.settings_guestSessions_removeAll_invitesUnavailable());
    }
    return lines;
  }

  function removeAllGuests(workspaceId: string) {
    if (!actionReady()) return;
    appStore.dispatch(removeAllHostedGuestsRequested(workspaceId));
  }
</script>

{#if $multiplayer$}
  <div class="space-y-8" data-testid="guest-sessions-settings">
    <div>
      <h2 class="type-title mb-3 text-foreground">
        {m.settings_guestSessions_title()}
      </h2>
      <p class="max-w-2xl type-body text-muted-foreground">
        {m.settings_guestSessions_description()}
      </p>
    </div>

    {#snippet identitySummary()}
      <div data-testid="collaboration-current-identity">
        {#if !$ready$}
          <p class="type-body text-muted-foreground" role="status">
            {m.settings_collaboration_identity_unavailable_description()}
          </p>
        {:else if currentIdentity}
          <p class="type-body font-medium break-words text-foreground">
            {$principal$?.principal.displayName ||
              $principal$?.principal.login ||
              currentIdentity.externalUserId}
          </p>
          <p class="type-caption break-words text-muted-foreground">
            {#if $principal$?.principal.login}@{$principal$.principal.login} ·
            {/if}
            {currentIdentity.provider === 'github'
              ? m.workspace_share_pinProvider_github_label()
              : m.workspace_share_pinProvider_gitlab_label({ host: currentIdentity.host })}
            {#if currentIdentity.provider === 'github'}
              · {currentIdentity.host}{/if}
          </p>
        {:else}
          <p class="type-body text-muted-foreground">
            {localIdentityAction
              ? m.settings_collaboration_identity_empty_description()
              : m.settings_collaboration_identity_remoteEmpty_description()}
          </p>
        {/if}
      </div>
    {/snippet}
    <SettingsSection
      id="collaboration-identity"
      title={m.settings_collaboration_identity_title()}
      description={m.settings_collaboration_identity_description()}
    >
      {#snippet actions()}
        {#if localIdentityAction}
          <Button
            variant="outline"
            disabled={!$ready$}
            onclick={() => {
              if (
                selectConnectionsLoaded.select(appStore.state) &&
                selectCurrentConnectionId.select(appStore.state) === LOCAL_CONNECTION_ID &&
                actionReady()
              )
                appStore.dispatch(collaborationSignInRequested());
            }}
            >{currentIdentity
              ? m.collaborationAuth_signIn_label()
              : m.collaborationAuth_title()}</Button
          >
        {/if}
      {/snippet}
      <SettingsForm
        schema={identitySchema}
        custom={{ 'collaboration-account': identitySummary }}
        embedded
      />
    </SettingsSection>

    {#if $hostContext$}
      {#key $hostContext$}<HostMembershipSettings context={$hostContext$} />{/key}
    {/if}

    <SettingsSection
      id="collaboration-workspaces"
      title={m.settings_collaboration_workspaces_title()}
    >
      {#if $ready$ && ($canCreateWorkspace$ || $hosted$.length > 0)}
        <div class="p-4" data-testid="guest-sessions-hosting">
          <h3 class="type-body mb-3 font-medium text-foreground">
            {m.settings_guestSessions_hosting_title()}
          </h3>
          {#if $hosted$.length > 0}
            <div class="flex flex-col overflow-hidden rounded-xl bg-card divide-y divide-border">
              {#each $hosted$ as workspace (workspace.id)}
                <HostedWorkspaceRoster
                  {workspace}
                  onRemoveAll={() => removeAllGuests(workspace.id)}
                />
              {/each}
            </div>
          {:else}
            <div class="space-y-1">
              <p class="type-body font-medium text-foreground">
                {m.settings_guestSessions_hosting_empty_title()}
              </p>
              <p class="type-body text-muted-foreground">
                {m.settings_guestSessions_hosting_empty_description()}
              </p>
            </div>
          {/if}
          {#each $removeAllReports$ as report (report.workspaceId)}
            {@const failures = removeAllFailureLines(report)}
            <div
              class="mt-3 flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
              role="alert"
              data-testid="hosted-roster-remove-all-error"
              data-workspace-id={report.workspaceId}
            >
              <div class="min-w-0 type-body text-danger">
                <p>
                  {m.settings_guestSessions_removeAll_error({
                    workspace: workspaceLabel({ title: report.workspaceTitle }),
                  })}
                </p>
                {#if failures.length > 0}
                  <ul class="mt-1 space-y-1">
                    {#each failures as line, index (index)}
                      <li>{line}</li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <Button
                variant="ghost"
                disabled={$sweepingWorkspaceIds$.includes(report.workspaceId)}
                onclick={() => removeAllGuests(report.workspaceId)}
              >
                {m.settings_guestSessions_retry_label()}
              </Button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="p-4" data-testid="guest-sessions-joined">
        <h3 class="type-body mb-3 font-medium text-foreground">
          {m.settings_guestSessions_joined_title()}
        </h3>
        {#if !$loaded$}
          <p class="type-body text-muted-foreground" role="status">
            {m.settings_guestSessions_loading_label()}
          </p>
        {:else if $sessions$.length > 0}
          <ListView
            virtualize={false}
            items={$sessions$}
            getKey={(session) => session.id}
            getText={(session) => formatGuestSessionLabel(session)}
            ariaLabel={m.settings_guestSessions_joined_title()}
            class="overflow-visible rounded-xl bg-card"
          >
            {#snippet row({ item: session })}
              {@const open = $openIds$.includes(session.id)}
              {@const connected = open && $connectedIds$.includes(session.id)}
              {@const guestAddress = formatGuestSessionAddress(session)}
              <div class="py-3" data-session-id={session.id}>
                <div class="flex flex-wrap items-center justify-between gap-3">
                  <div class="min-w-0">
                    <p class="truncate type-body text-foreground">
                      {formatGuestSessionLabel(session)}
                    </p>
                    <p class="truncate type-caption text-muted-foreground">
                      <!-- The dialled tc address / host stays visible once the
                       captured machine name is the primary label. -->
                      {#if guestAddress !== null}
                        <span data-guest-address={guestAddress}>{guestAddress}</span>
                        ·
                      {/if}
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
                      {session.login ? `@${session.login}` : session.principalId}
                      {#if $currentSession$?.id === session.id && $hostRole$ === 'member'}
                        · {m.collaboration_host_member_label()}{/if}
                      {#if session.identity}
                        · {session.identity.provider}@{session.identity.host} · {session.identity
                          .externalUserId}{/if}
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!$ready$ ||
                        ($openWorkflow$?.phase !== 'settled' &&
                          $openWorkflow$?.targetId === session.id)}
                      onclick={() => openHost(session)}
                    >
                      {m.settings_guestSessions_open_label()}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!$ready$ || $leavingIds$.includes(session.id)}
                      onclick={() => requestLeave(session)}
                    >
                      {$leavingIds$.includes(session.id)
                        ? m.settings_guestSessions_leaving_label()
                        : m.settings_guestSessions_leave_label()}
                    </Button>
                  </div>
                </div>
                {#if session.workspaces.length > 0}
                  <ul
                    class="mt-3 ml-3 border-l border-border pl-3 divide-y divide-border"
                    aria-label={m.settings_guestSessions_workspaces_ariaLabel({
                      name: formatGuestSessionLabel(session),
                    })}
                    data-testid="guest-session-workspaces"
                  >
                    {#each session.workspaces as workspace (workspace.id)}
                      {@const key = `${session.id}:${workspace.id}`}
                      <li
                        class="flex items-center justify-between gap-3 py-2"
                        data-workspace-id={workspace.id}
                      >
                        <p class="min-w-0 truncate type-body text-foreground">
                          {workspaceLabel(workspace)}
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!$ready$ ||
                            $leavingWorkspaceKeys$.includes(key) ||
                            $inheritedWorkspaceKeys$.includes(key)}
                          onclick={() => requestLeaveWorkspace(session, workspace)}
                        >
                          {$leavingWorkspaceKeys$.includes(key)
                            ? m.settings_guestSessions_leaving_label()
                            : m.settings_guestSessions_leaveWorkspace_label()}
                        </Button>
                      </li>
                      {#if $inheritedWorkspaceKeys$.includes(key)}
                        <li class="type-caption text-muted-foreground" role="status">
                          {m.collaboration_workspace_inherited_error()}
                        </li>
                      {/if}
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
          <div class="space-y-1">
            <p class="type-body font-medium text-foreground">
              {m.settings_guestSessions_joined_empty_title()}
            </p>
            <p class="type-body text-muted-foreground">
              {m.settings_guestSessions_joined_empty_description()}
            </p>
          </div>
        {/if}
      </div>
    </SettingsSection>

    {#if openError}
      <div
        class="rounded-md border border-danger/30 bg-danger-background/10 p-3"
        role="alert"
        data-testid="guest-sessions-open-error"
      >
        <p class="type-body text-danger">{openError}</p>
      </div>
    {/if}

    {#each $failedLeaves$ as failed (failed.id)}
      <div
        class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
        role="alert"
        data-testid="guest-leave-error"
        data-session-id={failed.id}
      >
        <p class="type-body text-danger">
          {m.settings_guestSessions_leave_error({ name: formatGuestSessionLabel(failed) })}
        </p>
        <Button
          variant="ghost"
          disabled={!$ready$ || $leavingIds$.includes(failed.id)}
          onclick={() => retryHost(failed)}
        >
          {m.settings_guestSessions_retry_label()}
        </Button>
      </div>
    {/each}

    {#each $failedLeaveWorkspaces$ as failed (workspaceKey(failed))}
      {@const key = workspaceKey(failed)}
      <div
        class="flex items-center justify-between gap-3 rounded-md border border-danger/30 bg-danger-background/10 p-3"
        role="alert"
        data-testid="guest-leave-workspace-error"
        data-workspace-id={failed.workspace.id}
      >
        <p class="type-body text-danger">
          {m.settings_guestSessions_leaveWorkspace_error({
            workspace: workspaceLabel(failed.workspace),
          })}
        </p>
        <Button
          variant="ghost"
          disabled={!$ready$ ||
            $leavingWorkspaceKeys$.includes(key) ||
            $inheritedWorkspaceKeys$.includes(key)}
          onclick={() => retryWorkspace(failed)}
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
      name: leaveTarget ? formatGuestSessionLabel(leaveTarget) : '',
    })}
    confirmText={m.settings_guestSessions_leave_label()}
    variant="destructive"
    onConfirm={() => void leaveHost(leaveTarget)}
  />

  <BulkActionConfirmDialog
    bind:open={leaveWorkspaceDialogOpen}
    title={m.settings_guestSessions_leaveWorkspaceConfirm_title()}
    description={m.settings_guestSessions_leaveWorkspaceConfirm_description({
      workspace: leaveWorkspaceTarget ? workspaceLabel(leaveWorkspaceTarget.workspace) : '',
      name: leaveWorkspaceTarget ? formatGuestSessionLabel(leaveWorkspaceTarget.session) : '',
    })}
    confirmText={m.settings_guestSessions_leaveWorkspace_label()}
    variant="destructive"
    onConfirm={() => void leaveWorkspace(leaveWorkspaceTarget)}
  />
{/if}
