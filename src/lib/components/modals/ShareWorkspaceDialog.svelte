<script lang="ts">
  /**
   * ShareWorkspaceDialog — the owner-side sharing surface (multiplayer w4).
   *
   * Offers the guests already authed on this host (`principal.list`, minus
   * the current roster) in an "Invite an existing user" dropdown whose
   * Invite attaches the pick directly (`workspace.members.add`, no link);
   * creates `intent://invite` links (optionally pinned to a GitHub login;
   * an unpinned link is reusable until it expires or is revoked, a pinned
   * one is single-use), lists the open invites with Copy link + Revoke, and
   * lists the member roster with Remove. A reusable row shows the join count
   * ("N joined") from the daemon's `reusable` / `redemptionCount`;
   * a daemon that predates those fields (every link single-use) shows the
   * pinned presentation for every row. Gated on a forge connection: members
   * are identified by their GitHub or GitLab account, so a daemon with neither
   * configured cannot mint invites and the dialog shows a connect-first state
   * instead. With both forges connected the pin field gains a provider
   * selector (seeded from the host's identity forge); with one, the pin is
   * sent bare and the daemon resolves it on its own identity forge. Member
   * rows carry the identity's forge icon and `@login` (GitLab rows name the
   * instance). Everything provider-aware is gated on `identitySeamSupported`:
   * against an older daemon the dialog is the GitHub-only one.
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
   * The workspace's guest cap (`guestCount` / `guestLimit` from
   * `workspace.members.list`, intent-hq/intentd#1917) is shown as
   * "Guests n / N"; at the cap Create is disabled with the reason inline.
   * The daemon still enforces the cap (`guest-limit`) for a raced create.
   *
   * Fully presentational: every row and in-flight flag arrives from the
   * workspace-share slice through the Redux host, and user intent (create /
   * revoke / remove / add) goes back as callbacks the host dispatches. Only
   * the pin input draft, the existing-guest pick, the pending Remove
   * confirmation, and the clipboard copy live
   * here. Invite links never ride the store: the host resolves them from the
   * invite-link vault into `inviteLinks` (by invite id), and a row with no
   * link (the daemon's Remote Access listener is down) has its Copy disabled.
   */

  import { tick, untrack } from 'svelte';
  import Fa from 'svelte-fa';
  import { faCopy, faLink, faUserPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { menuItem } from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { Select } from '$lib/components/ui/select';
  import { ListView } from '$lib/components/patterns/collection';
  import { notify } from '$lib/components/patterns/notify';
  import { formatInteger, formatRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceRole } from '$shared/types';
  import type {
    HostPrincipal,
    IdentityProvider,
    InvitePin,
    PrincipalIdentity,
    WorkspaceInvite,
    WorkspaceMember,
  } from '$features/workspace-sharing/types';
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
    /** `sourceControl.authStatus { provider: "gitlab" }.isConfigured` as mirrored by the gitlab-auth slice. */
    gitlabConnected?: boolean;
    /** The GitLab instance the host's connection targets (`pinHost` for a GitLab pin). */
    gitlabHost?: string;
    /**
     * The connected daemon serves the identity seam — `pinProvider` /
     * `pinHost` on `workspace.invite.create` and `identity` on member rows.
     * While false the dialog keeps the GitHub-only shapes: no provider
     * selector, a bare pin, and a GitLab connection is not an identity forge.
     */
    identitySeamSupported?: boolean;
    /**
     * The forge that is the host's identity (its `principal.me` triple, else
     * the daemon's implied default), `null` while unlinked. Seeds the pin's
     * provider choice, as the daemon defaults `pinProvider` to it.
     */
    identityProvider?: IdentityProvider | null;
    /** Owner of the target workspace and not withheld by the daemon. */
    canManage?: boolean;
    members?: WorkspaceMember[];
    invites?: WorkspaceInvite[];
    /**
     * Guests already authed on this host and not yet on the roster (the host
     * filters `principal.list` against `members`); the section is hidden
     * when empty.
     */
    principals?: HostPrincipal[];
    /**
     * `intent://invite` link per invite id (open rows + `createdLink`), resolved
     * by the host from the invite-link vault; a missing entry disables Copy.
     */
    inviteLinks?: Readonly<Record<string, string>>;
    /** Guests spent (collaborators + open invites); `null` while unknown. */
    guestCount?: number | null;
    /** The workspace's guest cap; `null` while unknown (no gating). */
    guestLimit?: number | null;
    loading?: boolean;
    loadError?: string | null;
    creating?: boolean;
    createError?: string | null;
    createdLink?: WorkspaceShareCreatedLink | null;
    revokingInviteId?: string | null;
    removingPrincipalId?: string | null;
    /** `workspace.members.add` in flight for this host principal. */
    addingPrincipalId?: string | null;
    actionError?: string | null;
    /** github-user-search slice: results for `userSearchQuery`. */
    userSuggestions?: GithubUserSearchItem[];
    userSearchLoading?: boolean;
    userSearchError?: string | null;
    /** The normalized query that produced `userSuggestions` (slice `lastQuery`). */
    userSearchQuery?: string;
    onClose?: () => void;
    onConnectGitHub?: () => void;
    /** Open Settings → Connections (the GitLab connect path). */
    onOpenConnections?: () => void;
    /**
     * `pin` names the forge `pinLogin` lives on; absent when the host has one
     * forge connected, so the daemon defaults to its own identity provider.
     */
    onCreateInvite?: (pinLogin: string, pin?: InvitePin) => void;
    onRevokeInvite?: (inviteId: string) => void;
    onRemoveMember?: (principalId: string) => void;
    /** Attach a `principals` row as a collaborator (`workspace.members.add`). */
    onAddMember?: (principalId: string) => void;
    /** Debounced by the saga; `''` clears the cached results. */
    onSearchUsers?: (query: string) => void;
  }

  let {
    open = false,
    workspaceId = null,
    workspaceTitle = '',
    githubConnected = false,
    gitlabConnected = false,
    gitlabHost = '',
    identitySeamSupported = false,
    identityProvider = null,
    canManage = false,
    members = [],
    invites = [],
    principals = [],
    inviteLinks = {},
    guestCount = null,
    guestLimit = null,
    loading = false,
    loadError = null,
    creating = false,
    createError = null,
    createdLink = null,
    revokingInviteId = null,
    removingPrincipalId = null,
    addingPrincipalId = null,
    actionError = null,
    userSuggestions = [],
    userSearchLoading = false,
    userSearchError = null,
    userSearchQuery = '',
    onClose,
    onConnectGitHub,
    onOpenConnections,
    onCreateInvite,
    onRevokeInvite,
    onRemoveMember,
    onAddMember,
    onSearchUsers,
  }: Props = $props();

  const busy = $derived(
    revokingInviteId !== null || removingPrincipalId !== null || addingPrincipalId !== null,
  );
  /** GitLab counts as an identity forge only once the daemon serves the seam. */
  const gitlabIdentityConnected = $derived(identitySeamSupported && gitlabConnected);
  /** Any forge identity on the host lets it mint invites. */
  const forgeConnected = $derived(githubConnected || gitlabIdentityConnected);
  /** Both forges connected on a seam-capable daemon: the pin's forge is the owner's pick. */
  const pinProviderChoosable = $derived(githubConnected && gitlabIdentityConnected);
  /** The forge the pin is resolved on; `null` while no forge is connected. */
  const pinProvider = $derived.by((): IdentityProvider | null => {
    if (!forgeConnected) return null;
    if (pinProviderChoosable) {
      if (pinProviderDraft) return pinProviderDraft;
      if (identityProvider) return identityProvider;
      return 'github';
    }
    return githubConnected ? 'github' : 'gitlab';
  });
  /** Only the GitHub typeahead exists; a GitLab pin is free text. */
  const pinTypeahead = $derived(pinProvider === 'github');
  const pinProviderItems = $derived([
    { value: 'github', label: m.workspace_share_pinProvider_github_label() },
    {
      value: 'gitlab',
      label: m.workspace_share_pinProvider_gitlab_label({ host: gitlabHost }),
    },
  ]);
  /** The cap is known and spent: no further invite can be minted. */
  const atGuestCap = $derived(
    guestCount !== null && guestLimit !== null && guestCount >= guestLimit,
  );

  let pinLogin = $state('');
  /** The owner's forge pick for the pin when both are connected; `''` follows `identityProvider`. */
  let pinProviderDraft = $state<IdentityProvider | ''>('');
  /** Suggestion the user picked; wins over the free-text draft on submit. */
  let selectedUser = $state<GithubUserSearchItem | null>(null);
  /** Escape closes the list until the next keystroke. */
  let suggestionsDismissed = $state(false);
  /** Highlighted suggestion row; -1 means none. */
  let activeSuggestion = $state(-1);
  let pinInput = $state<ReturnType<typeof Input> | null>(null);
  let pinAnchor = $state<HTMLDivElement | null>(null);
  let suggestionList = $state<HTMLDivElement | null>(null);
  /** Member row awaiting Remove confirmation. */
  let confirmRemovePrincipalId = $state<string | null>(null);
  /** The existing-guest dropdown pick (`principalId`); `''` for none. */
  let selectedPrincipalId = $state('');
  let existingGuestMenuOpen = $state(false);
  let pinProviderMenuOpen = $state(false);
  /** A Select menu is open inside the dialog; Escape closes it before the dialog. */
  const selectMenuOpen = $derived(existingGuestMenuOpen || pinProviderMenuOpen);

  function closeSelectMenus() {
    existingGuestMenuOpen = false;
    pinProviderMenuOpen = false;
  }

  const principalItems = $derived(
    principals.map((principal) => ({
      value: principal.principalId,
      label: principalLabel(principal),
    })),
  );
  const selectedPrincipal = $derived(
    principals.find((principal) => principal.principalId === selectedPrincipalId) ?? null,
  );

  // A pick that left the list (added to the roster, or revoked itself) is cleared.
  $effect(() => {
    if (selectedPrincipalId && !selectedPrincipal) selectedPrincipalId = '';
  });

  const pinQuery = $derived(normalizeGithubUserQuery(pinLogin));
  const pinSearchable = $derived(pinTypeahead && pinQuery.length >= GITHUB_USER_QUERY_MIN_LENGTH);
  /** The slice caught up with the input; anything else is stale or pending. */
  const suggestionsCurrent = $derived(pinSearchable && userSearchQuery === pinQuery);
  const visibleSuggestions = $derived(
    suggestionsCurrent ? userSuggestions.slice(0, MAX_USER_SUGGESTIONS) : [],
  );
  const suggestionsOpen = $derived(pinSearchable && !selectedUser && !suggestionsDismissed);

  $effect(() => {
    if (suggestionsOpen && activeSuggestion >= 0) {
      suggestionList?.children[activeSuggestion]?.scrollIntoView?.({ block: 'nearest' });
    }
  });

  function dismissSuggestions() {
    suggestionsDismissed = true;
    activeSuggestion = -1;
  }

  function keepPinInteraction(event: Event) {
    if (event.target instanceof Node && pinAnchor?.contains(event.target)) event.preventDefault();
  }

  function resetPinDraft() {
    pinLogin = '';
    pinProviderDraft = '';
    selectedUser = null;
    suggestionsDismissed = false;
    activeSuggestion = -1;
    onSearchUsers?.('');
  }

  function handlePinProviderChange(value: string) {
    pinProviderDraft = value === 'github' || value === 'gitlab' ? value : '';
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
    selectedPrincipalId = '';
    closeSelectMenus();
  });
  $effect(() => {
    if (createdLink) untrack(resetPinDraft);
  });

  function handlePinInput(value: string) {
    suggestionsDismissed = false;
    activeSuggestion = -1;
    if (!pinTypeahead) return;
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
      dismissSuggestions();
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
    if (!workspaceId || !canManage || creating || atGuestCap) return;
    const login = selectedUser ? selectedUser.login : pinLogin.trim();
    let pin: InvitePin | undefined;
    if (login && pinProviderChoosable && pinProvider) {
      pin =
        pinProvider === 'gitlab'
          ? { provider: 'gitlab', host: gitlabHost }
          : { provider: 'github' };
    }
    if (pin) onCreateInvite?.(login, pin);
    else onCreateInvite?.(login);
  }

  function inviteExistingGuest() {
    if (!workspaceId || !canManage || busy || atGuestCap || !selectedPrincipal) return;
    onAddMember?.(selectedPrincipal.principalId);
  }

  function principalLabel(principal: HostPrincipal): string {
    return principal.login ? `@${principal.login}` : principal.displayName || principal.principalId;
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      notify.success(m.workspace_share_linkCopied_toast());
    } catch {
      notify.error(m.workspace_share_linkCopyFailed_error());
    }
  }

  function inviteLink(inviteId: string): string | null {
    return inviteLinks[inviteId] ?? null;
  }

  function copyInvite(invite: Pick<WorkspaceInvite, 'id'>) {
    const url = inviteLink(invite.id);
    if (url) void copyLink(url);
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

  function providerIcon(identity: Pick<PrincipalIdentity, 'provider'>) {
    return identity.provider === 'gitlab' ? faGitlab : faGithub;
  }

  function roleLabel(role: WorkspaceRole): string {
    return role === 'owner'
      ? m.workspace_share_role_owner_label()
      : m.workspace_share_role_collaborator_label();
  }

  function inviteAudience(invite: Pick<WorkspaceInvite, 'pinLogin' | 'pinIdentity'>): string {
    if (!invite.pinLogin) return m.workspace_share_invite_anyone_label();
    if (invite.pinIdentity?.provider === 'gitlab') {
      return m.workspace_share_invite_pinnedGitlab_label({
        login: `@${invite.pinLogin}`,
        host: invite.pinIdentity.host,
      });
    }
    return m.workspace_share_invite_pinned_label({ login: `@${invite.pinLogin}` });
  }

  /**
   * The row's secondary line: the join count for a reusable link combined
   * with the expiry through the catalog (`_reusableDetail_label`), so each
   * locale owns the separator and order; the expiry alone otherwise.
   */
  function inviteDetail(
    invite: Pick<WorkspaceInvite, 'reusable' | 'redemptionCount' | 'expiresAt'>,
  ): string {
    const expires = m.workspace_share_invite_expires_label({
      when: formatRelativeTime(invite.expiresAt),
    });
    if (invite.reusable !== true) return expires;
    const count = invite.redemptionCount ?? 0;
    const reusable =
      count === 1
        ? m.workspace_share_invite_reusable_one()
        : m.workspace_share_invite_reusable_many({ count: formatInteger(count) });
    return m.workspace_share_invite_reusableDetail_label({ reusable, expires });
  }

  function handleKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      if (selectMenuOpen) {
        e.preventDefault();
        closeSelectMenus();
      } else {
        onClose?.();
      }
    }
  }
</script>

{#snippet userAvatar(user: GithubUserSearchItem)}
  <PrincipalAvatar
    avatarUrl={user.avatarUrl}
    label={user.login}
    size={24}
    testid="share-pin-avatar"
  />
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
        {:else if !forgeConnected}
          <div
            class="flex flex-col items-start gap-3 rounded border border-border bg-muted/50 p-4"
            data-testid="share-github-required"
          >
            <div class="flex items-center gap-2 text-sm font-medium">
              <Fa icon={faGithub} />
              <Fa icon={faGitlab} />
              {m.workspace_share_forgeRequired_title()}
            </div>
            <p class="text-sm text-subtle">{m.workspace_share_forgeRequired_description()}</p>
            <div class="flex items-center gap-2">
              <Button variant="secondary" size="sm" onclick={() => onConnectGitHub?.()}>
                {m.workspace_share_connectGithub_label()}
              </Button>
              <Button variant="ghost-light" size="sm" onclick={() => onOpenConnections?.()}>
                {m.workspace_share_openConnections_label()}
              </Button>
            </div>
          </div>
        {:else}
          <p class="text-sm text-subtle">
            {m.workspace_share_dialog_description({ title: workspaceTitle })}
          </p>

          {#if principals.length > 0}
            <section
              class="space-y-2"
              aria-labelledby="share-existing-guest-label"
              data-testid="share-existing-guest"
            >
              <Label id="share-existing-guest-label" for="share-existing-guest">
                {m.workspace_share_existingGuest_label()}
              </Label>
              <div class="flex items-center gap-2">
                <div class="min-w-0 flex-1">
                  <Select.Root
                    bind:open={existingGuestMenuOpen}
                    bind:value={selectedPrincipalId}
                    items={principalItems}
                    disabled={busy}
                  >
                    <Select.Trigger
                      id="share-existing-guest"
                      data-testid="share-existing-guest-trigger"
                    >
                      <Select.Value placeholder={m.workspace_share_existingGuest_placeholder()} />
                    </Select.Trigger>
                    <Select.Content class="z-(--layer-modal)">
                      {#each principals as principal (principal.principalId)}
                        <Select.Item
                          value={principal.principalId}
                          label={principalLabel(principal)}
                        >
                          <span class="flex min-w-0 items-center gap-2">
                            <PrincipalAvatar
                              avatarUrl={principal.avatarUrl}
                              label={principalLabel(principal)}
                              size={20}
                            />
                            <span class="truncate">{principalLabel(principal)}</span>
                          </span>
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!selectedPrincipal || busy || atGuestCap}
                  title={atGuestCap ? m.workspace_share_guestLimitReached_notice() : undefined}
                  onclick={inviteExistingGuest}
                  data-testid="share-existing-guest-invite"
                >
                  <Fa icon={faUserPlus} />
                  {addingPrincipalId !== null
                    ? m.workspace_share_existingGuest_inviting_label()
                    : m.workspace_share_existingGuest_invite_label()}
                </Button>
              </div>
              <p class="text-xs text-subtle">{m.workspace_share_existingGuest_description()}</p>
            </section>
          {/if}

          <form
            class="space-y-2"
            onsubmit={(e) => {
              e.preventDefault();
              createInvite();
            }}
          >
            <Label id="share-pin-login-label" for="share-pin-login">
              {pinProvider === 'gitlab'
                ? m.workspace_share_pinLogin_gitlab_label()
                : m.workspace_share_pinLogin_label()}
            </Label>
            <div class="flex items-center gap-2">
              {#if pinProviderChoosable}
                <div class="w-40 shrink-0">
                  <Select.Root
                    bind:open={pinProviderMenuOpen}
                    value={pinProvider ?? ''}
                    onchange={handlePinProviderChange}
                    items={pinProviderItems}
                    disabled={creating}
                  >
                    <Select.Trigger
                      id="share-pin-provider"
                      aria-label={m.workspace_share_pinProvider_ariaLabel()}
                      data-testid="share-pin-provider-trigger"
                    >
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content class="z-(--layer-modal)">
                      {#each pinProviderItems as item (item.value)}
                        <Select.Item value={item.value} label={item.label}>
                          <span class="flex min-w-0 items-center gap-2">
                            <Fa icon={item.value === 'gitlab' ? faGitlab : faGithub} />
                            <span class="truncate">{item.label}</span>
                          </span>
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
              {/if}
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
                <Popover.Root
                  open={suggestionsOpen}
                  onOpenChange={(next) => {
                    if (!next) dismissSuggestions();
                  }}
                >
                  <div bind:this={pinAnchor} class="min-w-0 flex-1">
                    <Input
                      id="share-pin-login"
                      bind:this={pinInput}
                      bind:value={pinLogin}
                      autocomplete="off"
                      spellcheck={false}
                      disabled={creating}
                      placeholder={pinTypeahead
                        ? m.workspace_share_pinLogin_placeholder()
                        : m.workspace_share_pinLogin_gitlab_placeholder()}
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
                    <Popover.Content
                      portal={false}
                      customAnchor={pinAnchor}
                      align="start"
                      collisionPadding={8}
                      trapFocus={false}
                      preventScroll={false}
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      onCloseAutoFocus={(event) => event.preventDefault()}
                      onInteractOutside={keepPinInteraction}
                      onFocusOutside={(event) => {
                        keepPinInteraction(event);
                        if (!event.defaultPrevented) dismissSuggestions();
                      }}
                      onEscapeKeydown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        dismissSuggestions();
                      }}
                      role="presentation"
                      class="z-(--layer-modal) w-(--bits-popover-anchor-width) max-h-[min(18rem,var(--bits-popover-content-available-height))] overflow-y-auto"
                      data-testid="share-pin-suggestions"
                    >
                      {#if visibleSuggestions.length > 0}
                        <div
                          bind:this={suggestionList}
                          id="share-pin-suggestions"
                          role="listbox"
                          aria-label={m.workspace_share_userSuggestions_ariaLabel()}
                          class="py-1"
                        >
                          {#each visibleSuggestions as user, index (user.login)}
                            <Button
                              variant="ghost"
                              id="share-pin-suggestion-{index}"
                              role="option"
                              aria-selected={index === activeSuggestion}
                              tabindex={-1}
                              class={`${menuItem()} h-auto rounded-none px-3 py-1.5 font-normal hover:border-transparent ${index === activeSuggestion ? 'bg-accent/20 hover:bg-accent/20' : 'hover:bg-muted/50'}`}
                              data-testid="share-pin-suggestion"
                              data-login={user.login}
                              onpointerdown={(event) => event.preventDefault()}
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
                    </Popover.Content>
                  </div>
                </Popover.Root>
              {/if}
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={creating || atGuestCap}
                title={atGuestCap ? m.workspace_share_guestLimitReached_notice() : undefined}
              >
                <Fa icon={faLink} />
                {creating
                  ? m.workspace_share_creating_label()
                  : m.workspace_share_createLink_label()}
              </Button>
            </div>
            {#if atGuestCap}
              <p class="text-xs text-subtle" role="status" data-testid="share-guest-cap-reached">
                {m.workspace_share_guestLimitReached_notice()}
              </p>
            {/if}
            {#if createError}
              <p class="text-xs text-danger" role="alert" data-testid="share-create-error">
                {createError}
              </p>
            {/if}
          </form>

          {#if createdLink && inviteLink(createdLink.inviteId)}
            {@const createdUrl = inviteLink(createdLink.inviteId) ?? ''}
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
                      <div class="text-xs text-subtle" data-testid="share-invite-detail">
                        {inviteDetail(invite)}
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost-light"
                        size="sm"
                        disabled={!inviteLink(invite.id)}
                        title={inviteLink(invite.id)
                          ? undefined
                          : m.workspace_share_linkUnavailable_tooltip()}
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
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="type-caption font-medium text-subtle">
                {m.workspace_share_members_label()}
              </h3>
              {#if guestCount !== null && guestLimit !== null}
                <span
                  class="text-xs text-subtle"
                  data-testid="share-guest-count"
                  data-guest-count={guestCount}
                  data-guest-limit={guestLimit}
                >
                  {m.workspace_share_guests_label({
                    count: formatInteger(guestCount),
                    limit: formatInteger(guestLimit),
                  })}
                </span>
              {/if}
            </div>
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
                      <PrincipalAvatar
                        avatarUrl={member.avatarUrl}
                        label={memberName(member)}
                        size={24}
                      />
                      <div class="min-w-0">
                        <div class="truncate text-sm">{memberName(member)}</div>
                        <div class="flex min-w-0 items-center gap-1 text-xs text-subtle">
                          {#if member.identity}
                            <span
                              class="flex shrink-0 items-center"
                              data-testid="share-member-identity"
                              data-provider={member.identity.provider}
                            >
                              <Fa icon={providerIcon(member.identity)} size="xs" />
                            </span>
                            <span class="truncate">
                              {m.workspace_share_member_identityRole_label({
                                handle: memberHandle(member),
                                role: roleLabel(member.role),
                              })}
                            </span>
                          {:else}
                            <span>{roleLabel(member.role)}</span>
                          {/if}
                        </div>
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
