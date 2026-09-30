<script lang="ts">
  import { onMount, untrack } from 'svelte';
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
    hostMembershipClosed,
    hostMembershipRequested,
    type HostMembershipCommand,
  } from '$store/renderer/slices/host-membership/host-membership-slice';
  import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';

  const { context }: { context: string } = $props();
  const session = $props.id();
  const target = { session, context: untrack(() => context) };
  const state$ = selectHostMembershipState();
  const members$ = selectHostMembers();
  const invites$ = selectHostInvites();
  const gitlab$ = selectLabsGitLabEnabled();
  let provider = $state<'github' | 'gitlab'>('github');
  let account = $state('');
  let host = $state('gitlab.com');
  let confirmation = $state<HostMembershipCommand | null>(null);
  let confirmationLabel = $state('');
  let confirmOpen = $state(false);
  const invalid = $derived(
    !account.trim() || !canonicalInviteHost(provider, provider === 'gitlab' ? host : 'github.com'),
  );
  function send(command: HostMembershipCommand) {
    if (selectHostMembershipContext.select(appStore.state) !== context) return;
    appStore.dispatch(hostMembershipRequested(target, command));
  }
  function confirm(command: HostMembershipCommand) {
    confirmationLabel =
      command.kind === 'create'
        ? `${command.input.pinLogin} · ${command.input.pinProvider}@${command.input.pinHost}`
        : command.kind === 'remove'
          ? ($members$.find((item) => item.principalId === command.principalId)?.displayName ??
            command.principalId)
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
          id: 'host-invitation',
          title: m.collaboration_host_invite_title(),
          description: m.collaboration_host_invite_description(),
          entries: [
            {
              id: 'host-pin-provider',
              kind: 'select',
              label: m.collaboration_pin_provider_label(),
              get: () => provider,
              set: (value) => {
                provider = value === 'gitlab' ? 'gitlab' : 'github';
              },
              options: [
                { value: 'github', label: m.workspace_share_pinProvider_github_label() },
                ...($gitlab$ || provider === 'gitlab'
                  ? [
                      {
                        value: 'gitlab',
                        label: m.workspace_share_pinProvider_gitlab_label({ host }),
                      },
                    ]
                  : []),
              ],
              disabled: $state$.busy || $state$.withheld,
            },
            {
              id: 'host-pin-instance',
              kind: 'input',
              label: m.collaboration_pin_instance_label(),
              when: () => provider === 'gitlab',
              get: () => host,
              set: (value) => {
                host = value;
              },
              disabled: $state$.busy || $state$.withheld,
            },
            {
              id: 'host-pin-account',
              kind: 'input',
              label: m.collaboration_pin_account_label(),
              get: () => account,
              set: (value) => {
                account = value;
              },
              disabled: $state$.busy || $state$.withheld,
            },
            {
              id: 'host-invite-create',
              kind: 'action',
              label: m.collaboration_host_invite_scope(),
              description: m.collaboration_host_invite_permissions(),
              actionLabel: m.workspace_share_createLink_label(),
              disabled:
                $state$.busy || $state$.withheld || invalid || (provider === 'gitlab' && !$gitlab$),
              action: () =>
                confirm({
                  kind: 'create',
                  input: {
                    pinLogin: account.trim(),
                    pinProvider: provider,
                    pinHost: canonicalInviteHost(
                      provider,
                      provider === 'gitlab' ? host : 'github.com',
                    )!,
                  },
                }),
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

<div class="space-y-6" data-testid="host-membership-settings">
  <SettingsForm {schema} />
  {#if $state$.error}
    <p role="alert" class="type-body text-danger">{$state$.error}</p>
    <Button disabled={$state$.busy || $state$.withheld} onclick={() => send({ kind: 'load' })}
      >{m.collaboration_host_refresh_label()}</Button
    >
  {/if}
  <SettingsSection
    id="host-members"
    title={m.collaboration_host_members_title()}
    busy={$state$.busy || $state$.withheld}
  >
    {#snippet actions()}<Button
        variant="ghost"
        disabled={$state$.busy || $state$.withheld}
        onclick={() => send({ kind: 'load' })}>{m.collaboration_host_refresh_label()}</Button
      >{/snippet}
    <ListView
      items={$members$}
      getKey={(item) => item.principalId}
      virtualize={false}
      ariaLabel={m.collaboration_host_members_title()}
    >
      {#snippet row({ item })}
        <ListRow>
          {#snippet title()}{item.displayName ?? item.login ?? item.principalId}{/snippet}
          {#snippet description()}
            {item.hostRole === 'owner'
              ? m.workspace_share_role_owner_label()
              : m.collaboration_host_member_label()}
            {#if item.identity}
              · {item.identity.provider}@{item.identity.host} · {item.identity.externalUserId}{/if}
          {/snippet}
          {#snippet trailing()}{#if item.hostRole === 'member'}<Button
                variant="ghost"
                disabled={$state$.busy || $state$.withheld}
                onclick={() => confirm({ kind: 'remove', principalId: item.principalId })}
                >{m.settings_guestSessions_remove_label()}</Button
              >{/if}{/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  </SettingsSection>
  <SettingsSection id="host-invites" title={m.workspace_share_openInvites_label()}>
    <ListView
      items={$invites$}
      getKey={(item) => item.id}
      virtualize={false}
      ariaLabel={m.workspace_share_openInvites_label()}
    >
      {#snippet row({ item })}
        <ListRow>
          {#snippet title()}@{item.pinLogin} · {item.pinIdentity.provider}@{item.pinIdentity
              .host}{/snippet}
          {#snippet description()}{m.collaboration_host_expires_label({
              date: formatDateTime(item.expiresAt),
            })}{/snippet}
          {#snippet trailing()}
            <Button
              variant="ghost"
              disabled={$state$.busy || $state$.withheld}
              onclick={() => send({ kind: 'copy', inviteId: item.id })}
              >{m.workspace_share_copyLink_label()}</Button
            >
            <Button
              variant="ghost"
              disabled={$state$.busy || $state$.withheld}
              onclick={() => confirm({ kind: 'revoke', inviteId: item.id })}
              >{m.workspace_share_revoke_label()}</Button
            >
          {/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  </SettingsSection>
</div>
<BulkActionConfirmDialog
  bind:open={confirmOpen}
  title={confirmation?.kind === 'create'
    ? m.collaboration_host_invite_title()
    : confirmation?.kind === 'revoke'
      ? m.collaboration_host_revoke_title()
      : m.collaboration_host_remove_title()}
  description={confirmation?.kind === 'create'
    ? m.collaboration_host_invite_permissions()
    : confirmation?.kind === 'revoke'
      ? m.collaboration_host_revoke_description()
      : m.collaboration_host_remove_description()}
  confirmText={confirmation?.kind === 'create'
    ? m.workspace_share_createLink_label()
    : confirmation?.kind === 'revoke'
      ? m.workspace_share_revoke_label()
      : m.settings_guestSessions_remove_label()}
  variant={confirmation?.kind === 'create' ? 'default' : 'destructive'}
  body={confirmBody}
  onConfirm={() => {
    if (confirmation) send(confirmation);
  }}
/>

{#snippet confirmBody()}<p class="type-body font-medium">{confirmationLabel}</p>{/snippet}
