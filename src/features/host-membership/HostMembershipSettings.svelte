<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { defineSettings, SettingsForm, SettingsSection } from '$lib/components/patterns/settings';
  import { Button } from '$lib/components/patterns/settings/custom-controls';
  import { ListView, ListRow } from '$lib/components/patterns/collection';
  import BulkActionConfirmDialog from '$lib/components/modals/BulkActionConfirmDialog.svelte';
  import { formatDateTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import { store as appStore } from '$store/renderer/store';
  import { selectLabsGitLabEnabled } from '$store/renderer/slices/user-preferences/user-preferences-selectors';
  import {
    selectHostMembers,
    selectHostInvites,
    selectHostMembershipState,
    selectHostMembershipContext,
  } from '$store/renderer/slices/host-membership/host-membership-selectors';
  import {
    hostMembershipOpened,
    hostMembershipRebound,
    hostMembershipClosed,
    hostMembershipRequested,
    hostMembershipInviteCleared,
    type HostMembershipCommand,
  } from '$store/renderer/slices/host-membership/host-membership-slice';
  import HostInvitationDialog from './HostInvitationDialog.svelte';
  import { readHostInviteLink } from './invite-links';

  const { context, suspended = false }: { context: string; suspended?: boolean } = $props();
  const session = $props.id();
  const target = $derived({ session, context });
  let openedContext = untrack(() => context);
  $effect(() => {
    if (context !== openedContext) {
      openedContext = context;
      appStore.dispatch(hostMembershipRebound(target));
    }
  });
  const state$ = selectHostMembershipState();
  const members$ = selectHostMembers();
  const invites$ = selectHostInvites();
  const context$ = selectHostMembershipContext();
  const gitlab$ = selectLabsGitLabEnabled();
  let invitationOpen = $state(false);
  let inviteButton = $state<HTMLButtonElement | undefined>();
  function closeInvitation() {
    appStore.dispatch(hostMembershipInviteCleared(target));
    invitationOpen = false;
    void tick().then(() => inviteButton?.focus());
  }
  let confirmation = $state<HostMembershipCommand | null>(null);
  let confirmationLabel = $state('');
  let confirmOpen = $state(false);
  const allowed = $derived(
    $context$ === target.context && context === target.context && !$state$.withheld,
  );
  const createdLink = $derived(
    $state$.createdInviteId ? readHostInviteLink(session, $state$.createdInviteId) : null,
  );
  $effect(() => {
    if (!allowed && !suspended) {
      invitationOpen = false;
      confirmOpen = false;
      confirmation = null;
    }
  });
  function send(command: HostMembershipCommand) {
    const current = selectHostMembershipState.select(appStore.state);
    if (
      selectHostMembershipContext.select(appStore.state) !== target.context ||
      context !== target.context ||
      current.target?.session !== target.session ||
      current.target.context !== target.context ||
      current.busy ||
      current.withheld
    )
      return;
    appStore.dispatch(hostMembershipRequested(target, command));
  }
  function confirm(command: HostMembershipCommand) {
    confirmationLabel =
      command.kind === 'remove'
        ? $members$.find((item) => item.principalId === command.principalId)?.displayName ||
          $members$.find((item) => item.principalId === command.principalId)?.login ||
          command.principalId
        : command.kind === 'revoke'
          ? ($invites$.find((item) => item.id === command.inviteId)?.pinLogin ?? command.inviteId)
          : '';
    confirmation = command;
    confirmOpen = true;
  }
  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'host-membership',
          title: m.collaboration_host_members_title(),
          entries: [
            {
              id: 'host-membership-lists',
              kind: 'custom',
              layout: 'full-width',
              label: m.collaboration_host_members_title(),
              class: 'p-0 first:pt-0 last:pb-0',
            },
          ],
        },
      ],
    }),
  );
  onMount(() => {
    appStore.dispatch(hostMembershipOpened(target));
    return () => appStore.dispatch(hostMembershipClosed(target));
  });
</script>

<SettingsSection
  id="collaboration-sharing"
  title={m.settings_collaboration_sharing_title()}
  description={m.settings_collaboration_sharing_description()}
  busy={$state$.busy || $state$.withheld}
>
  {#snippet actions()}
    <Button
      bind:ref={inviteButton}
      aria-haspopup="dialog"
      disabled={!allowed || $state$.busy}
      onclick={() => {
        invitationOpen = true;
      }}>{m.collaboration_host_invite_title()}</Button
    >
  {/snippet}
  <SettingsForm {schema} embedded custom={{ 'host-membership-lists': membershipLists }} />
</SettingsSection>
{#snippet membershipLists()}
  <div class="space-y-4 p-4" data-testid="host-membership-settings">
    {#if $state$.error}
      <p role="alert" class="type-body text-danger">{$state$.error}</p>
    {/if}
    <div>
      <div class="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h3 class="type-body font-medium text-foreground">
          {m.collaboration_host_members_title()}
        </h3>
      </div>
      <ListView
        items={$members$}
        getKey={(item) => item.principalId}
        virtualize={false}
        ariaLabel={m.collaboration_host_members_title()}
      >
        {#snippet empty()}<p class="type-body text-muted-foreground">
            {m.settings_collaboration_members_empty_description()}
          </p>{/snippet}
        {#snippet row({ item })}
          <ListRow
            class="flex-col sm:flex-row [&_[data-slot=list-row-title]]:whitespace-normal [&_[data-slot=list-row-title]]:break-words"
          >
            {#snippet title()}{item.displayName ||
                (item.login
                  ? `@${item.login}`
                  : m.settings_collaboration_profileUnavailable_label())}{/snippet}
            {#snippet description()}
              {item.hostRole === 'owner'
                ? m.workspace_share_role_owner_label()
                : m.collaboration_host_member_label()}
              {#if item.login}
                · @{item.login}{/if}
              {#if item.identity}
                · {item.identity.provider === 'github'
                  ? m.workspace_share_pinProvider_github_label()
                  : m.workspace_share_pinProvider_gitlab_label({ host: item.identity.host })}{/if}
            {/snippet}
            {#snippet trailing()}{#if item.hostRole === 'member'}<Button
                  variant="ghost"
                  disabled={!allowed || $state$.busy}
                  onclick={() => confirm({ kind: 'remove', principalId: item.principalId })}
                  >{m.settings_guestSessions_remove_label()}</Button
                >{/if}{/snippet}
          </ListRow>
        {/snippet}
      </ListView>
    </div>
    <div>
      <h3 class="mb-2 type-body font-medium text-foreground">
        {m.workspace_share_openInvites_label()}
      </h3>
      <ListView
        items={$invites$}
        getKey={(item) => item.id}
        virtualize={false}
        ariaLabel={m.workspace_share_openInvites_label()}
      >
        {#snippet empty()}<p class="type-body text-muted-foreground">
            {m.settings_collaboration_invites_empty_description()}
          </p>{/snippet}
        {#snippet row({ item })}
          <ListRow
            class="flex-col sm:flex-row [&_[data-slot=list-row-title]]:whitespace-normal [&_[data-slot=list-row-title]]:break-words"
          >
            {#snippet title()}@{item.pinLogin} · {item.pinIdentity.provider === 'github'
                ? m.workspace_share_pinProvider_github_label()
                : m.workspace_share_pinProvider_gitlab_label({
                    host: item.pinIdentity.host,
                  })}{/snippet}
            {#snippet description()}{m.collaboration_host_expires_label({
                date: formatDateTime(item.expiresAt),
              })}{/snippet}
            {#snippet trailing()}
              <Button
                variant="ghost"
                disabled={!allowed || $state$.busy}
                onclick={() => send({ kind: 'copy', inviteId: item.id })}
                >{m.workspace_share_copyLink_label()}</Button
              >
              <Button
                variant="ghost"
                disabled={!allowed || $state$.busy}
                onclick={() => confirm({ kind: 'revoke', inviteId: item.id })}
                >{m.workspace_share_revoke_label()}</Button
              >
            {/snippet}
          </ListRow>
        {/snippet}
      </ListView>
    </div>
  </div>
{/snippet}

<BulkActionConfirmDialog
  bind:open={confirmOpen}
  preflightReady={allowed &&
    !suspended &&
    !$state$.busy &&
    $state$.target?.session === target.session &&
    $state$.target.context === target.context}
  title={confirmation?.kind === 'revoke'
    ? m.collaboration_host_revoke_title()
    : m.collaboration_host_remove_title()}
  description={confirmation?.kind === 'revoke'
    ? m.collaboration_host_revoke_description()
    : m.collaboration_host_remove_description()}
  confirmText={confirmation?.kind === 'revoke'
    ? m.workspace_share_revoke_label()
    : m.settings_guestSessions_remove_label()}
  variant="destructive"
  body={confirmBody}
  onConfirm={() => {
    if (confirmation) send(confirmation);
  }}
/>

{#snippet confirmBody()}<p class="type-body font-medium">{confirmationLabel}</p>{/snippet}

{#if invitationOpen && (allowed || suspended)}
  <HostInvitationDialog
    busy={$state$.busy || suspended}
    creating={$state$.creating}
    error={$state$.error}
    gitlabEnabled={$gitlab$}
    {createdLink}
    onClose={closeInvitation}
    onCreate={(input) => send({ kind: 'create', input })}
    onCopy={() => {
      if ($state$.createdInviteId) send({ kind: 'copy', inviteId: $state$.createdInviteId });
    }}
  />
{/if}
