<script lang="ts">
  /**
   * ShareWorkspaceDialog — the owner-side sharing surface (multiplayer w4).
   *
   * Creates one-shot `intent://invite` links (optionally pinned to a GitHub
   * login), lists the open invites with Copy link + Revoke, and lists the
   * member roster with Remove. Gated on the GitHub connection: members are identified by
   * their GitHub account, so a daemon without a configured login cannot mint
   * invites and the dialog shows a connect-first state instead.
   *
   * Owner-only: `canManage` is false for a collaborator connection (or once
   * the daemon refused an owner-only method with `-32003`), and the dialog then
   * renders the owner-only notice instead of any control or row. Member Remove
   * is confirmation-gated (inline confirm on the row).
   *
   * The pin field is a GitHub user typeahead: typing dispatches a debounced
   * `github.users.search` through `onSearchUsers` and the suggestions arrive
   * back as props from the github-user-search slice; picking a row pins the
   * invite to that login (rendered as a chip), free text still submits as-is.
   *
   * Fully presentational: every row and in-flight flag arrives from the
   * workspace-share slice through the Redux host, and user intent (create /
   * revoke / remove) goes back as callbacks the host dispatches. Only the pin
   * input draft, the pending Remove confirmation, and the clipboard copy live
   * here. Every open invite row carries its `url` (absent while the daemon's
   * Remote Access listener is down, which disables that row's Copy).
   */

  import { tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCopy, faLink, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { faGithub } from '@fortawesome/free-brands-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { menuItem } from '$lib/components/ui/menu';
  import { ListView } from '$lib/components/patterns/collection';
  import { notify } from '$lib/components/patterns/notify';
  import { formatRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceRole } from '$shared/types';
  import type { WorkspaceInvite, WorkspaceMember } from '$features/workspace-sharing/types';
  import {
    GITHUB_USER_QUERY_MIN_LENGTH,
    normalizeGithubUserQuery,
  } from '$features/workspace-sharing/utils/github-user-query';
  import type { GithubUserSearchItem } from '$store/renderer/slices/github-user-search/github-user-search-slice';
  import type { WorkspaceShareCreatedLink } from '$store/renderer/slices/workspace-share/workspace-share-slice';

  /** Rows shown in the pin typeahead (the daemon default page size). */
  const MAX_USER_SUGGESTIONS = 8;

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
    revokingInviteId?: string | null;
    removingPrincipalId?: string | null;
    actionError?: string | null;
    /** github-user-search slice: results for `userSearchQuery`. */
    userSuggestions?: GithubUserSearchItem[];
    userSearchLoading?: boolean;
    userSearchError?: string | null;
    /** The normalized query that produced `userSuggestions` (slice `lastQuery`). */
    userSearchQuery?: string;
    onClose?: () => void;
    onConnectGitHub?: () => void;
    onCreateInvite?: (pinLogin: string) => void;
    onRevokeInvite?: (inviteId: string) => void;
    onRemoveMember?: (principalId: string) => void;
    /** Debounced by the saga; `''` clears the cached results. */
    onSearchUsers?: (query: string) => void;
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
    revokingInviteId = null,
    removingPrincipalId = null,
    actionError = null,
    userSuggestions = [],
    userSearchLoading = false,
    userSearchError = null,
    userSearchQuery = '',
    onClose,
    onConnectGitHub,
    onCreateInvite,
    onRevokeInvite,
    onRemoveMember,
    onSearchUsers,
  }: Props = $props();

  const busy = $derived(revokingInviteId !== null || removingPrincipalId !== null);

  let pinLogin = $state('');
  /** Suggestion the user picked; wins over the free-text draft on submit. */
  let selectedUser = $state<GithubUserSearchItem | null>(null);
  /** Escape closes the list until the next keystroke. */
  let suggestionsDismissed = $state(false);
  /** Highlighted suggestion row; -1 means none. */
  let activeSuggestion = $state(-1);
  let pinInput = $state<ReturnType<typeof Input> | null>(null);
  /** Member row awaiting Remove confirmation. */
  let confirmRemovePrincipalId = $state<string | null>(null);

  const pinQuery = $derived(normalizeGithubUserQuery(pinLogin));
  const pinSearchable = $derived(
    githubConnected && pinQuery.length >= GITHUB_USER_QUERY_MIN_LENGTH,
  );
  /** The slice caught up with the input; anything else is stale or pending. */
  const suggestionsCurrent = $derived(pinSearchable && userSearchQuery === pinQuery);
  const visibleSuggestions = $derived(
    suggestionsCurrent ? userSuggestions.slice(0, MAX_USER_SUGGESTIONS) : [],
  );
  const suggestionsOpen = $derived(pinSearchable && !selectedUser && !suggestionsDismissed);

  function resetPinDraft() {
    pinLogin = '';
    selectedUser = null;
    suggestionsDismissed = false;
    activeSuggestion = -1;
    onSearchUsers?.('');
  }

  // Drafts reset when the dialog retargets and after a link is minted.
  $effect(() => {
    void open;
    void workspaceId;
    untrack(resetPinDraft);
    confirmRemovePrincipalId = null;
  });
  $effect(() => {
    if (createdLink) untrack(resetPinDraft);
  });

  function handlePinInput(value: string) {
    suggestionsDismissed = false;
    activeSuggestion = -1;
    if (!githubConnected) return;
    onSearchUsers?.(normalizeGithubUserQuery(value));
  }

  function handlePinKeydown(e: KeyboardEvent) {
    if (!suggestionsOpen) return;
    if (e.key === 'ArrowDown') {
      if (!visibleSuggestions.length) return;
      e.preventDefault();
      activeSuggestion = Math.min(activeSuggestion + 1, visibleSuggestions.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (!visibleSuggestions.length) return;
      e.preventDefault();
      activeSuggestion = Math.max(activeSuggestion - 1, -1);
      return;
    }
    if (e.key === 'Enter') {
      const highlighted = visibleSuggestions[activeSuggestion];
      if (!highlighted) return;
      e.preventDefault();
      selectUser(highlighted);
      return;
    }
    if (e.key === 'Escape') {
      // Close the list only; a second Escape reaches the dialog and closes it.
      e.preventDefault();
      e.stopPropagation();
      suggestionsDismissed = true;
      activeSuggestion = -1;
    }
  }

  function selectUser(user: GithubUserSearchItem) {
    selectedUser = user;
    pinLogin = user.login;
    activeSuggestion = -1;
    onSearchUsers?.('');
  }

  async function clearSelectedUser() {
    selectedUser = null;
    pinLogin = '';
    await tick();
    pinInput?.focus();
  }

  function createInvite() {
    if (!workspaceId || !canManage || creating) return;
    onCreateInvite?.(selectedUser ? selectedUser.login : pinLogin.trim());
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify.success(m.workspace_share_linkCopied_toast());
    } catch {
      notify.error(m.workspace_share_linkCopyFailed_error());
    }
  }

  function copyInvite(invite: Pick<WorkspaceInvite, 'url'>) {
    if (invite.url) void copyLink(invite.url);
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

{#snippet userAvatar(user: GithubUserSearchItem)}
  {#if user.avatarUrl}
    <img
      src={user.avatarUrl}
      alt=""
      class="h-6 w-6 shrink-0 rounded-full"
      loading="lazy"
      data-testid="share-pin-avatar"
    />
  {:else}
    <span
      class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-xs"
      aria-hidden="true"
      data-testid="share-pin-avatar-fallback">{user.login.slice(0, 1).toUpperCase()}</span
    >
  {/if}
{/snippet}

{#if open}
  <div
    class="fixed inset-0 bg-background/60 flex items-center justify-center z-50 p-8"
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
            <Button variant="secondary" size="sm" onclick={() => onConnectGitHub?.()}>
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
            <Label id="share-pin-login-label" for="share-pin-login">
              {m.workspace_share_pinLogin_label()}
            </Label>
            <div class="flex items-center gap-2">
              {#if selectedUser}
                <div
                  class="flex h-(--control-height-medium) min-w-0 flex-1 items-center gap-2 rounded-(--radius-medium) border border-border bg-card px-2"
                  role="group"
                  aria-labelledby="share-pin-login-label"
                  data-testid="share-pin-selected"
                  data-login={selectedUser.login}
                >
                  {@render userAvatar(selectedUser)}
                  <span class="min-w-0 flex-1 truncate text-sm">@{selectedUser.login}</span>
                  <Button
                    variant="ghost-light"
                    size="icon-compact"
                    iconOnly
                    class="size-5 rounded-full"
                    disabled={creating}
                    onclick={() => void clearSelectedUser()}
                    aria-label={m.workspace_share_pinSelected_clear_ariaLabel({
                      login: `@${selectedUser.login}`,
                    })}
                  >
                    <Fa icon={faXmark} size="xs" />
                  </Button>
                </div>
              {:else}
                <div class="relative min-w-0 flex-1">
                  <Input
                    id="share-pin-login"
                    bind:this={pinInput}
                    bind:value={pinLogin}
                    autocomplete="off"
                    spellcheck={false}
                    disabled={creating}
                    placeholder={m.workspace_share_pinLogin_placeholder()}
                    role="combobox"
                    aria-autocomplete="list"
                    aria-controls="share-pin-suggestions"
                    aria-expanded={suggestionsOpen}
                    aria-activedescendant={suggestionsOpen && visibleSuggestions[activeSuggestion]
                      ? `share-pin-suggestion-${activeSuggestion}`
                      : undefined}
                    oninput={(e) => handlePinInput(e.currentTarget.value)}
                    onkeydown={handlePinKeydown}
                  />
                  {#if suggestionsOpen}
                    <div
                      class="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded border border-border bg-background shadow-md"
                      data-testid="share-pin-suggestions"
                    >
                      {#if visibleSuggestions.length > 0}
                        <div
                          id="share-pin-suggestions"
                          role="listbox"
                          aria-label={m.workspace_share_userSuggestions_ariaLabel()}
                          class="max-h-72 overflow-y-auto py-1"
                        >
                          {#each visibleSuggestions as user, index (user.login)}
                            <Button
                              variant="ghost"
                              id="share-pin-suggestion-{index}"
                              role="option"
                              aria-selected={index === activeSuggestion}
                              class={`${menuItem()} h-auto rounded-none px-3 py-1.5 font-normal hover:border-transparent ${index === activeSuggestion ? 'bg-accent/20 hover:bg-accent/20' : 'hover:bg-muted/50'}`}
                              data-testid="share-pin-suggestion"
                              data-login={user.login}
                              onclick={() => selectUser(user)}
                              onmousemove={() => (activeSuggestion = index)}
                            >
                              {@render userAvatar(user)}
                              <span class="truncate">@{user.login}</span>
                            </Button>
                          {/each}
                        </div>
                      {:else if suggestionsCurrent && userSearchError}
                        <p
                          class="px-3 py-2 text-xs text-danger"
                          role="alert"
                          data-testid="share-pin-search-error"
                        >
                          {userSearchError}
                        </p>
                      {:else if !suggestionsCurrent || userSearchLoading}
                        <p
                          class="px-3 py-2 text-xs text-subtle"
                          role="status"
                          data-testid="share-pin-searching"
                        >
                          {m.workspace_share_userSearch_searching_label()}
                        </p>
                      {:else}
                        <p
                          class="px-3 py-2 text-xs text-subtle"
                          role="status"
                          data-testid="share-pin-no-results"
                        >
                          {m.workspace_share_userSearch_noResults_label()}
                        </p>
                      {/if}
                    </div>
                  {/if}
                </div>
              {/if}
              <Button type="submit" variant="secondary" size="sm" disabled={creating}>
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

          {#if createdLink}
            {@const createdUrl = createdLink.url}
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
                  data-testid="share-created-link-url">{createdUrl}</code
                >
                <Button variant="secondary" size="sm" onclick={() => void copyLink(createdUrl)}>
                  <Fa icon={faCopy} />
                  {m.workspace_share_copyLink_label()}
                </Button>
              </div>
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
              <h3 class="type-caption font-medium text-subtle">
                {m.workspace_share_openInvites_label()}
              </h3>
              <ListView
                virtualize={false}
                items={invites}
                getKey={(invite) => invite.id}
                getText={(invite) => inviteAudience(invite)}
                ariaLabel={m.workspace_share_openInvites_label()}
                class="overflow-visible rounded border border-border"
              >
                {#snippet row({ item: invite })}
                  <div
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
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost-light"
                        size="sm"
                        disabled={!invite.url}
                        title={invite.url ? undefined : m.workspace_share_listenerDown_error()}
                        onclick={() => copyInvite(invite)}
                        aria-label={m.workspace_share_copyInvite_ariaLabel({
                          audience: inviteAudience(invite),
                        })}
                        data-testid="share-invite-copy"
                      >
                        <Fa icon={faCopy} />
                        {m.workspace_share_copyLink_label()}
                      </Button>
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
                    </div>
                  </div>
                {/snippet}
              </ListView>
            </section>
          {/if}

          <section class="space-y-2" aria-label={m.workspace_share_members_label()}>
            <h3 class="type-caption font-medium text-subtle">
              {m.workspace_share_members_label()}
            </h3>
            {#if loading && members.length === 0}
              <p class="text-xs text-subtle" data-testid="share-members-loading">
                {m.workspace_share_loading_label()}
              </p>
            {:else}
              <ListView
                virtualize={false}
                items={members}
                getKey={(member) => member.principalId}
                getText={(member) => memberName(member)}
                ariaLabel={m.workspace_share_members_label()}
                class="overflow-visible rounded border border-border"
              >
                {#snippet row({ item: member })}
                  <div
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
                  </div>
                {/snippet}
              </ListView>
            {/if}
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}
