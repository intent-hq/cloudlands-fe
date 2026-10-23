<script lang="ts">
  import Fa from 'svelte-fa';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import * as Menu from '$lib/components/ui/menu';
  import { isWorkspaceGuest } from '$features/workspace-sharing/utils/workspace-guest';
  import type { WorkspaceMember } from '$features/workspace-sharing/types';
  import type { WorkspaceGuestRole, WorkspaceRole } from '$shared/types';
  import { m } from '$shared/paraglide/messages.js';

  let {
    member,
    ownerPrincipalId = null,
    editable = false,
    disabled = false,
    pending = false,
    error,
    onSetRole,
    removeDisabled = false,
    confirmRemovePrincipalId = $bindable(null),
    onRemoveMember,
  }: {
    member: WorkspaceMember;
    ownerPrincipalId?: string | null;
    editable?: boolean;
    disabled?: boolean;
    pending?: boolean;
    error?: string;
    removeDisabled?: boolean;
    confirmRemovePrincipalId?: string | null;
    onRemoveMember?: (principalId: string) => void;
    onSetRole?: (principalId: string, role: WorkspaceGuestRole) => void;
  } = $props();
  const isOwner = $derived(member.principalId === ownerPrincipalId || member.role === 'owner');
  const isGuest = $derived(!isOwner && isWorkspaceGuest(member));
  const name = $derived(member.displayName || member.login || member.principalId);

  function roleLabel(role: WorkspaceRole): string {
    if (role === 'owner') return m.workspace_share_role_owner_label();
    if (role === 'manager') return m.workspace_share_role_manager_label();
    return m.workspace_share_role_collaborator_label();
  }

  function memberRoleLabel(member: WorkspaceMember): string {
    if (isOwner) return m.workspace_share_role_owner_label();
    if (member.hostRole === 'owner') return m.settings_personalDevices_owner_label();
    if (member.hostRole === 'member') return m.collaboration_host_member_label();
    return roleLabel(member.role);
  }

  function setRole(role: string) {
    if (
      !editable ||
      disabled ||
      pending ||
      !isGuest ||
      (role !== 'collaborator' && role !== 'manager') ||
      role === member.role
    )
      return;
    onSetRole?.(member.principalId, role);
  }
  /** `@login` on the member's forge (GitLab names the instance); the forge alone without a login. */
  function memberHandle(member: Pick<WorkspaceMember, 'login' | 'identity'>): string {
    const identity = member.identity;
    if (!identity) return '';
    if (identity.provider === 'gitlab') {
      return member.login
        ? m.workspace_share_member_gitlabHandle_label({
            login: `@${member.login}`,
            host: identity.host,
          })
        : m.workspace_share_pinProvider_gitlab_label({ host: identity.host });
    }
    return member.login ? `@${member.login}` : m.workspace_share_pinProvider_github_label();
  }

  function providerIcon(identity: Pick<NonNullable<WorkspaceMember['identity']>, 'provider'>) {
    return identity.provider === 'gitlab' ? faGitlab : faGithub;
  }
</script>

<div
  class="space-y-2 px-3.5 py-3"
  data-testid="share-member-row"
  data-principal-id={member.principalId}
>
  <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <div class="flex min-w-0 flex-1 basis-28 items-center gap-3 text-sm">
      <PrincipalAvatar avatarUrl={member.avatarUrl} label={name} size={32} />
      <div class="min-w-0">
        <div class="truncate text-sm" title={name}>
          {name}
        </div>
        {#if member.identity}
          <div class="flex min-w-0 items-center gap-1 text-xs text-subtle">
            <span
              class="flex shrink-0 items-center"
              data-testid="share-member-identity"
              data-provider={member.identity.provider}
            >
              <Fa icon={providerIcon(member.identity)} size="xs" />
            </span>
            <span class="truncate">{memberHandle(member)}</span>
          </div>
        {/if}
      </div>
    </div>
    <div class="ml-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-1">
      {#if editable && isGuest}
        <Menu.Root>
          <Menu.Trigger
            disabled={disabled || pending || !onSetRole}
            aria-label={m.workspace_share_role_ariaLabel({
              name,
            })}
            aria-busy={pending}
            aria-describedby={error ? `share-role-error-${member.principalId}` : undefined}
          >
            {#snippet child({ props })}
              <Button {...props} variant="ghost-light" size="sm">
                {roleLabel(member.role)}
                <Fa icon={faChevronDown} class="size-3 shrink-0 text-subtle" />
              </Button>
            {/snippet}
          </Menu.Trigger>
          <Menu.Content
            align="end"
            class="z-(--layer-modal) w-72 max-w-[calc(100vw-2rem)]"
            aria-label={m.workspace_share_role_ariaLabel({
              name,
            })}
          >
            <Menu.RadioGroup bind:value={() => member.role, setRole}>
              <Menu.RadioItem
                value="collaborator"
                aria-label={m.workspace_share_role_collaborator_label()}
                closeOnSelect
                class="h-auto py-2 whitespace-normal"
                aria-describedby={`share-participant-description-${member.principalId}`}
              >
                <div class="min-w-0 flex-1">
                  <div>{m.workspace_share_role_collaborator_label()}</div>
                  <p
                    id={`share-participant-description-${member.principalId}`}
                    class="mt-1 whitespace-normal text-xs text-subtle"
                  >
                    {m.workspace_share_role_participant_description()}
                  </p>
                </div>
              </Menu.RadioItem>
              <Menu.RadioItem
                value="manager"
                aria-label={m.workspace_share_role_manager_label()}
                closeOnSelect
                class="h-auto py-2 whitespace-normal"
                aria-describedby={`share-manager-description-${member.principalId}`}
              >
                <div class="min-w-0 flex-1">
                  <div>{m.workspace_share_role_manager_label()}</div>
                  <p
                    id={`share-manager-description-${member.principalId}`}
                    class="mt-1 whitespace-normal text-xs text-subtle"
                  >
                    {m.workspace_share_role_manager_description()}
                  </p>
                </div>
              </Menu.RadioItem>
            </Menu.RadioGroup>
          </Menu.Content>
        </Menu.Root>
      {:else}
        <span class="px-3 text-xs text-subtle">{memberRoleLabel(member)}</span>
      {/if}

      {#if isGuest}
        {#if confirmRemovePrincipalId === member.principalId}
          <div
            class="flex shrink-0 items-center gap-1"
            role="group"
            aria-label={m.workspace_share_removeMember_confirm_label({
              name,
            })}
            data-testid="share-remove-confirm"
          >
            <Button
              variant="destructive"
              size="sm"
              disabled={removeDisabled || pending}
              onclick={() => onRemoveMember?.(member.principalId)}
              aria-label={m.workspace_share_removeMember_confirmAction_ariaLabel({
                name,
              })}
            >
              {m.workspace_share_removeMember_label()}
            </Button>
            <Button
              variant="ghost-light"
              size="sm"
              onclick={() => (confirmRemovePrincipalId = null)}
            >
              {m.workspace_share_cancel_label()}
            </Button>
          </div>
        {:else}
          <Button
            variant="ghost-light"
            size="sm"
            disabled={removeDisabled || pending}
            onclick={() => (confirmRemovePrincipalId = member.principalId)}
            aria-label={m.workspace_share_removeMember_ariaLabel({
              name,
            })}
          >
            {m.workspace_share_removeMember_label()}
          </Button>
        {/if}
      {/if}
    </div>
  </div>
  {#if pending}
    <p class="text-right text-xs text-subtle" role="status">
      {m.workspace_share_role_saving_label()}
    </p>
  {/if}
  {#if error}
    <p
      id={`share-role-error-${member.principalId}`}
      class="break-words text-xs text-danger"
      role="alert"
    >
      {error}
    </p>
  {/if}
</div>
