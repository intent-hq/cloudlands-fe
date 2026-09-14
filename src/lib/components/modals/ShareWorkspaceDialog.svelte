<script lang="ts">
  /**
   * ShareWorkspaceDialog — the owner-side sharing surface (multiplayer w4).
   *
   * Creates one-shot `intent://invite` links (optionally pinned to a GitHub
   * login), lists the open invites with Revoke, and lists the member roster
   * with Remove. Gated on the GitHub connection: members are identified by
   * their GitHub account, so a daemon without a configured login cannot mint
   * invites and the dialog shows a connect-first state instead.
   *
   * Owner-only: `canManage` is false for a collaborator connection (or once
   * the daemon refused an owner-only method with `-32003`), and the dialog then
   * renders the owner-only notice instead of any control or row. Member Remove
   * is confirmation-gated (inline confirm on the row).
   *
   * Fully presentational: every row and in-flight flag arrives from the
   * workspace-share slice through the Redux host, and user intent (create /
   * revoke / remove) goes back as callbacks the host dispatches. Only the pin
   * input draft, the pending Remove confirmation, and the clipboard copy live
   * here; the invite url arrives as a plain prop and is never echoed.
   */

  import Fa from 'svelte-fa';
  import { faCopy, faLink, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { formatRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceRole } from '$shared/types';
  import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
  import type { WorkspaceShareCreatedLink } from '$store/renderer/slices/workspace-share/workspace-share-slice';

  interface Props {
    open?: boolean;
    workspaceId?: string | null;
    workspaceTitle?: string;
    /** `github.authStatus.isConfigured` as mirrored by the github-auth slice. */
    githubConnected?: boolean;
    /** Owner of the target workspace and not withheld by the daemon. */
    canManage?: boolean;
    members?: WorkspaceMember[];
    invites?: WorkspaceInvite[];
    loading?: boolean;
    loadError?: string | null;
    creating?: boolean;
    createError?: string | null;
    createdLink?: WorkspaceShareCreatedLink | null;
    /** The one-time url behind `createdLink`, resolved by the host. */
    createdLinkUrl?: string | null;
    revokingInviteId?: string | null;
    removingPrincipalId?: string | null;
    actionError?: string | null;
    onClose?: () => void;
    onConnectGitHub?: () => void;
    onCreateInvite?: (pinLogin: string) => void;
    onRevokeInvite?: (inviteId: string) => void;
    onRemoveMember?: (principalId: string) => void;
  }

  let {
    open = false,
    workspaceId = null,
    workspaceTitle = '',
    githubConnected = false,
    canManage = false,
    members = [],
    invites = [],
    loading = false,
    loadError = null,
    creating = false,
    createError = null,
    createdLink = null,
    createdLinkUrl = null,
    revokingInviteId = null,
    removingPrincipalId = null,
    actionError = null,
    onClose,
    onConnectGitHub,
    onCreateInvite,
    onRevokeInvite,
    onRemoveMember,
  }: Props = $props();

  const busy = $derived(revokingInviteId !== null || removingPrincipalId !== null);

  let pinLogin = $state('');
  /** Member row awaiting Remove confirmation. */
  let confirmRemovePrincipalId = $state<string | null>(null);

  // Drafts reset when the dialog retargets and after a link is minted.
  $effect(() => {
    void open;
    void workspaceId;
    pinLogin = '';
    confirmRemovePrincipalId = null;
  });
  $effect(() => {
    if (createdLink) pinLogin = '';
  });

  function createInvite() {
    if (!workspaceId || !canManage || creating) return;
    onCreateInvite?.(pinLogin.trim());
  }

  async function copyLink() {
    if (!createdLinkUrl) return;
    const { toast } = await import('svelte-sonner');
    try {
      await navigator.clipboard.writeText(createdLinkUrl);
      toast.success(m.workspace_share_linkCopied_toast());
    } catch {
      toast.error(m.workspace_share_linkCopyFailed_error());
    }
  }

  function revokeInvite(inviteId: string) {
    if (!workspaceId || !canManage || busy) return;
    onRevokeInvite?.(inviteId);
  }

  function confirmRemoveMember(principalId: string) {
    if (!workspaceId || !canManage || busy || confirmRemovePrincipalId !== principalId) return;
    confirmRemovePrincipalId = null;
    onRemoveMember?.(principalId);
  }

  function memberName(member: WorkspaceMember): string {
    return member.displayName || member.login || member.principalId;
  }

  function roleLabel(role: WorkspaceRole): string {
    return role === 'owner'
      ? m.workspace_share_role_owner_label()
      : m.workspace_share_role_collaborator_label();
  }

  function inviteAudience(invite: Pick<WorkspaceInvite, 'pinLogin'>): string {
    return invite.pinLogin
      ? m.workspace_share_invite_pinned_label({ login: `@${invite.pinLogin}` })
      : m.workspace_share_invite_anyone_label();
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') onClose?.();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-8"
    role="presentation"
    onclick={() => onClose?.()}
    onkeydown={handleKeydown}
  >
    <div
      class="bg-background border border-border rounded-lg shadow-lg w-full max-w-md max-h-full overflow-hidden flex flex-col"
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKeydown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-workspace-title"
      tabindex="-1"
      data-testid="share-workspace-dialog"
    >
      <div class="px-6 py-4 border-b border-border flex items-center justify-between">
        <h2 id="share-workspace-title" class="text-lg font-semibold">
          {m.workspace_share_dialog_title()}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onclick={() => onClose?.()}
          aria-label={m.workspace_share_close_ariaLabel()}
        >
          <Fa icon={faXmark} />
        </Button>
      </div>

      <div class="p-6 space-y-5 min-h-0 overflow-y-auto">
        {#if !canManage}
          <p class="text-sm text-subtle" role="status" data-testid="share-owner-only">
            {m.workspace_share_ownerOnly_notice()}
          </p>
        {:else if !githubConnected}
          <div
            class="flex flex-col items-start gap-3 rounded border border-border bg-muted/50 p-4"
            data-testid="share-github-required"
          >
            <div class="flex items-center gap-2 text-sm font-medium">
              <Fa icon={faGithub} />
              {m.workspace_share_githubRequired_title()}
            </div>
            <p class="text-sm text-subtle">{m.workspace_share_githubRequired_description()}</p>
            <Button variant="default" size="sm" onclick={() => onConnectGitHub?.()}>
              {m.workspace_share_connectGithub_label()}
            </Button>
          </div>
        {:else}
          <p class="text-sm text-subtle">
            {m.workspace_share_dialog_description({ title: workspaceTitle })}
          </p>

          <form
            class="space-y-2"
            onsubmit={(e) => {
              e.preventDefault();
              createInvite();
            }}
          >
            <Label for="share-pin-login">{m.workspace_share_pinLogin_label()}</Label>
            <div class="flex items-center gap-2">
              <Input
                id="share-pin-login"
                bind:value={pinLogin}
                placeholder={m.workspace_share_pinLogin_placeholder()}
                autocomplete="off"
                spellcheck={false}
                disabled={creating}
              />
              <Button type="submit" variant="default" size="sm" disabled={creating}>
                <Fa icon={faLink} />
                {creating
                  ? m.workspace_share_creating_label()
                  : m.workspace_share_createLink_label()}
              </Button>
            </div>
            {#if createError}
              <p class="text-xs text-danger" role="alert" data-testid="share-create-error">
                {createError}
              </p>
            {/if}
          </form>

          {#if createdLink && createdLinkUrl}
            <div
              class="space-y-2 rounded border border-border bg-muted/50 p-3"
              data-testid="share-created-link"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium">{m.workspace_share_newLink_label()}</span>
                <span class="text-xs text-subtle">{inviteAudience(createdLink)}</span>
              </div>
              <div class="flex items-center gap-2">
                <code
                  class="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-xs"
                  data-testid="share-created-link-url">{createdLinkUrl}</code
                >
                <Button variant="secondary" size="sm" onclick={() => void copyLink()}>
                  <Fa icon={faCopy} />
                  {m.workspace_share_copyLink_label()}
                </Button>
              </div>
              <p class="text-xs text-subtle">{m.workspace_share_newLink_description()}</p>
            </div>
          {/if}

          {#if loadError}
            <p class="text-sm text-danger" role="alert">{loadError}</p>
          {/if}
          {#if actionError}
            <p class="text-sm text-danger" role="alert" data-testid="share-action-error">
              {actionError}
            </p>
          {/if}

          {#if invites.length > 0}
            <section class="space-y-2" aria-label={m.workspace_share_openInvites_label()}>
              <h3 class="text-xs font-medium uppercase tracking-wide text-subtle">
                {m.workspace_share_openInvites_label()}
              </h3>
              <ul class="divide-y divide-border rounded border border-border" role="list">
                {#each invites as invite (invite.id)}
                  <li
                    class="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="share-invite-row"
                    data-invite-id={invite.id}
                  >
                    <div class="min-w-0">
                      <div class="truncate text-sm">{inviteAudience(invite)}</div>
                      <div class="text-xs text-subtle">
                        {m.workspace_share_invite_expires_label({
                          when: formatRelativeTime(invite.expiresAt),
                        })}
                      </div>
                    </div>
                    <Button
                      variant="ghost-light"
                      size="sm"
                      disabled={busy}
                      onclick={() => revokeInvite(invite.id)}
                      aria-label={m.workspace_share_revoke_ariaLabel({
                        audience: inviteAudience(invite),
                      })}
                    >
                      {m.workspace_share_revoke_label()}
                    </Button>
                  </li>
                {/each}
              </ul>
            </section>
          {/if}

          <section class="space-y-2" aria-label={m.workspace_share_members_label()}>
            <h3 class="text-xs font-medium uppercase tracking-wide text-subtle">
              {m.workspace_share_members_label()}
            </h3>
            {#if loading && members.length === 0}
              <p class="text-xs text-subtle" data-testid="share-members-loading">
                {m.workspace_share_loading_label()}
              </p>
            {:else}
              <ul class="divide-y divide-border rounded border border-border" role="list">
                {#each members as member (member.principalId)}
                  <li
                    class="flex items-center justify-between gap-3 px-3 py-2"
                    data-testid="share-member-row"
                    data-principal-id={member.principalId}
                  >
                    <div class="flex min-w-0 items-center gap-2">
                      {#if member.avatarUrl}
                        <img
                          src={member.avatarUrl}
                          alt=""
                          class="h-6 w-6 shrink-0 rounded-full"
                          loading="lazy"
                        />
                      {:else}
                        <span
                          class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs"
                          aria-hidden="true">{memberName(member).slice(0, 1).toUpperCase()}</span
                        >
                      {/if}
                      <div class="min-w-0">
                        <div class="truncate text-sm">{memberName(member)}</div>
                        <div class="text-xs text-subtle">{roleLabel(member.role)}</div>
                      </div>
                    </div>
                    {#if member.role !== 'owner'}
                      {#if confirmRemovePrincipalId === member.principalId}
                        <div
                          class="flex shrink-0 items-center gap-1"
                          role="group"
                          aria-label={m.workspace_share_removeMember_confirm_label({
                            name: memberName(member),
                          })}
                          data-testid="share-remove-confirm"
                        >
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={busy}
                            onclick={() => confirmRemoveMember(member.principalId)}
                            aria-label={m.workspace_share_removeMember_confirmAction_ariaLabel({
                              name: memberName(member),
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
                          disabled={busy}
                          onclick={() => (confirmRemovePrincipalId = member.principalId)}
                          aria-label={m.workspace_share_removeMember_ariaLabel({
                            name: memberName(member),
                          })}
                        >
                          {m.workspace_share_removeMember_label()}
                        </Button>
                      {/if}
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}
