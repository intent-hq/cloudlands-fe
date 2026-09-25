<script lang="ts">
  /**
   * Guest empty state (multiplayer w4): the `/workspace/new` surface of a
   * window bound to a host joined as a guest. A guest cannot create a
   * workspace (the repo picker is administrator-only), so the zero-workspace
   * route explains that nothing is shared yet and offers *Manage guest
   * sessions* plus *Leave host* (best-effort `principal.revokeSelf`, then the
   * local delete and window teardown — main-owned).
   */
  import { Button } from '$lib/components/ui/button';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { m } from '$shared/paraglide/messages.js';
  import type { GuestSessionRecord } from '$shared/types/guest-sessions';
  import { formatGuestSessionLabel } from '$lib/utils/connection-label';
  import { navigateToSettings } from '$lib/utils/workspace-navigation';
  import { leaveGuestSessionRequested } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
  import {
    selectGuestLeavingIds,
    selectGuestLeaveFailedIds,
  } from '$store/renderer/slices/guest-sessions/guest-sessions-selectors';
  import { store as appStore } from '$store/renderer/store';

  interface Props {
    session: GuestSessionRecord;
  }

  let { session }: Props = $props();

  let leaveDialogOpen = $state(false);
  const leavingIds$ = selectGuestLeavingIds();
  const failedIds$ = selectGuestLeaveFailedIds();
  const leaving = $derived($leavingIds$.includes(session.id));
  const leaveError = $derived(
    $failedIds$.includes(session.id)
      ? m.settings_guestSessions_leave_error({ name: formatGuestSessionLabel(session) })
      : null,
  );

  function leaveHost() {
    const action = leaveGuestSessionRequested(session.id);
    action.promise.catch(() => {});
    appStore.dispatch(action);
  }
</script>

<div class="flex h-full w-full items-center justify-center p-8" data-testid="guest-empty-state">
  <div
    class="w-full max-w-md rounded-xl border border-dashed border-border bg-card p-8 text-center"
  >
    <h2 class="text-lg font-semibold text-foreground">
      {m.guestSessions_emptyState_title()}
    </h2>
    <p class="mt-2 text-sm text-muted-foreground">
      {m.guestSessions_emptyState_description({ host: formatGuestSessionLabel(session) })}
    </p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-2">
      <Button variant="outline" onclick={() => void navigateToSettings({ tab: 'guest-sessions' })}>
        {m.layout_daemonStatus_manageGuestSessions_action()}
      </Button>
      <Button
        variant="destructive"
        disabled={leaving}
        onclick={() => (leaveDialogOpen = true)}
        data-testid="guest-empty-state-leave"
      >
        {leaving
          ? m.settings_guestSessions_leaving_label()
          : m.settings_guestSessions_leave_label()}
      </Button>
    </div>
    {#if leaveError}
      <p class="mt-4 text-sm text-danger" role="alert">{leaveError}</p>
    {/if}
  </div>
</div>

<BulkActionConfirmDialog
  bind:open={leaveDialogOpen}
  title={m.settings_guestSessions_leaveConfirm_title()}
  description={m.settings_guestSessions_leaveConfirm_description({
    name: formatGuestSessionLabel(session),
  })}
  confirmText={m.settings_guestSessions_leave_label()}
  variant="destructive"
  onConfirm={() => leaveHost()}
/>
