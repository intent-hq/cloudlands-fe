<script lang="ts">
  /** Audience selection and clipboard intent are local UI state. Membership,
   * invitations, permissions and setup arrive from the Redux host. A selection
   * never grants access; Copy link creates or reuses an invite for that audience.
   */

  import ShareWorkspaceMemberRow from './ShareWorkspaceMemberRow.svelte';
  import WorkspaceSharingSetup from '$features/workspace-sharing/components/WorkspaceSharingSetup.svelte';
  import {
    findCopyableInvite,
    type InviteAudience,
  } from '$features/workspace-sharing/utils/invite-audience';
  import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';
  import { tick, untrack } from 'svelte';
  import { animatedHeight } from '$lib/motion';
  import Fa from 'svelte-fa';
  import { faCopy, faGlobe, faUserPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
  import { faGithub, faGitlab } from '@fortawesome/free-brands-svg-icons';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { menuItem } from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import { Select } from '$lib/components/ui/select';
  import { ListView } from '$lib/components/patterns/collection';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { notify } from '$lib/components/patterns/notify';
  import { formatInteger, formatRelativeTime } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { WorkspaceGuestRole } from '$shared/types';
  import type {
    HostPrincipal,
    IdentityProvider,
    InvitePin,
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
  const sharingActionStyle =
    '--color-primary: var(--color-foreground); --color-primary-foreground: var(--color-background)';

  interface Props {
    open?: boolean;
    workspaceId?: string | null;
    workspaceTitle?: string;
    /** `github.authStatus.isConfigured` as mirrored by the github-auth slice. */
    githubConnected?: boolean;
    /** `sourceControl.authStatus { provider: "gitlab" }.isConfigured` as mirrored by the gitlab-auth slice. */
    gitlabConnected?: boolean;
    /** Labs gates new provider choices, never an existing identity or pin. */
    gitlabEnabled?: boolean;
    /** The GitLab instance the host's connection targets (`pinHost` for a GitLab pin). */
    gitlabHost?: string;
    gitlabStatusReady?: boolean;
    canAdministerHost?: boolean;
    sharingEnabled?: boolean | null;
    sharingChecking?: boolean;
    sharingEnabling?: boolean;
    sharingError?: string | null;
    onEnableSharing?: () => void;
    /**
     * The connected daemon serves the identity seam — `pinProvider` /
     * `pinHost` on `workspace.invite.create` and `identity` on member rows.
     * While false the dialog keeps the GitHub-only shapes: no provider
     * selector, a bare pin, and a GitLab connection is not an identity forge.
     */
    identitySeamSupported?: boolean;
    hostMembershipSupported?: boolean;
    /**
     * The forge that is the host's identity (its `principal.me` triple, else
     * the daemon's implied default), `null` while unlinked. Seeds the pin's
     * provider choice, as the daemon defaults `pinProvider` to it.
     */
    identityProvider?: IdentityProvider | null;
    /** Owner of the target workspace and not withheld by the daemon. */
    canManage?: boolean;
    /** Owner authorization combined with exact workspaceGuestRoles:1 support. */
    canSetMemberRole?: boolean;
    ownerPrincipalId?: string | null;
    pendingRolePrincipalIds?: string[];
    roleErrors?: Readonly<Record<string, string>>;
    onSetMemberRole?: (principalId: string, role: WorkspaceGuestRole) => void;
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
    gitlabEnabled = false,
    gitlabHost = '',
    gitlabStatusReady = true,
    canAdministerHost = true,
    sharingEnabled = true,
    sharingChecking = false,
    sharingEnabling = false,
    sharingError = null,
    onEnableSharing,
    identitySeamSupported = false,
    hostMembershipSupported = false,
    identityProvider = null,
    canManage = false,
    canSetMemberRole = false,
    ownerPrincipalId = null,
    pendingRolePrincipalIds = [],
    roleErrors = {},
    onSetMemberRole,
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
  const sharingReady = $derived(
    (canAdministerHost ? sharingEnabled === true : sharingEnabled !== false) &&
      !sharingChecking &&
      !sharingEnabling,
  );
  /** GitLab counts as an identity forge only once the daemon serves the seam. */
  const gitlabIdentityConnected = $derived(identitySeamSupported && gitlabConnected);
  /** Any forge identity on the host lets it mint invites. */
  const forgeConnected = $derived(
    hostMembershipSupported || githubConnected || gitlabIdentityConnected,
  );
  /** Both forges connected on a seam-capable daemon: the pin's forge is the owner's pick. */
  const pinProviderChoosable = $derived(
    hostMembershipSupported || (githubConnected && gitlabIdentityConnected),
  );
  /** The forge the pin is resolved on; `null` while no forge is connected. */
  const pinProvider = $derived.by((): IdentityProvider | null => {
    if (pinProviderDraft) return pinProviderDraft;
    if (!forgeConnected) return null;
    if (pinProviderChoosable) {
      if (
        identityProvider &&
        (!hostMembershipSupported || identityProvider !== 'gitlab' || gitlabEnabled)
      )
        return identityProvider;
      return 'github';
    }
    return githubConnected ? 'github' : 'gitlab';
  });
  /** Only the GitHub typeahead exists; a GitLab pin is free text. */
  const pinTypeahead = $derived(
    pinProvider === 'github' && (!hostMembershipSupported || githubConnected),
  );
  let pinHostDraft = $state('gitlab.com');
  let restricted = $state(false);
  const audienceItems = $derived([
    { value: 'anyone', label: m.workspace_share_invite_anyone_label(), icon: faGlobe },
    ...((forgeConnected || restricted) && (pinProviderChoosable || pinProvider === 'github')
      ? [{ value: 'github', label: m.workspace_share_audienceGithub_label(), icon: faGithub }]
      : []),
    ...((forgeConnected || restricted) &&
    (pinProviderChoosable || pinProvider === 'gitlab') &&
    (gitlabEnabled || pinProvider === 'gitlab')
      ? [{ value: 'gitlab', label: m.workspace_share_audienceGitlab_label(), icon: faGitlab }]
      : []),
  ]);
  const audienceValue = $derived(restricted ? (pinProvider ?? 'anyone') : 'anyone');
  let pendingCopy = $state<{ audience: InviteAudience; previousId?: string } | null>(null);
  let copying = $state(false);
  /** The cap is known and spent: no further invite can be minted. */
  const atGuestCap = $derived(
    guestCount !== null && guestLimit !== null && guestCount >= guestLimit,
  );

  let pinLogin = $state('');
  const selectedPinHost = $derived(
    hostMembershipSupported ? canonicalInviteHost('gitlab', pinHostDraft) : gitlabHost,
  );
  /** The owner's forge pick for the pin when both are connected; `''` follows `identityProvider`. */
  let pinProviderDraft = $state<IdentityProvider | ''>('');
  /** Suggestion the user picked; wins over the free-text draft on submit. */
  let selectedUser = $state<GithubUserSearchItem | null>(null);
  const audience = $derived<InviteAudience>({
    workspaceId: workspaceId ?? '',
    login: restricted ? (selectedUser?.login ?? pinLogin.trim()) : '',
    provider: restricted ? (pinProvider ?? 'github') : 'github',
    externalUserId: restricted && selectedUser ? String(selectedUser.githubUserId) : undefined,
    host: pinProvider === 'gitlab' ? (selectedPinHost ?? '') : 'github.com',
  });
  const matchingInvite = $derived(findCopyableInvite(invites, inviteLinks, audience));
  const linkActionLabel = $derived(
    restricted && (creating || pendingCopy || !matchingInvite)
      ? m.workspace_share_createRecipientLink_label()
      : m.workspace_share_copyLink_label(),
  );
  const recipientReady = $derived(
    !restricted ||
      (!!audience.login &&
        (hostMembershipSupported ||
          (pinProvider === 'github' ? githubConnected : gitlabIdentityConnected)) &&
        (!pinTypeahead || !!selectedUser) &&
        (pinProvider !== 'gitlab' ||
          (hostMembershipSupported
            ? !!selectedPinHost && gitlabEnabled
            : gitlabStatusReady && !!gitlabHost))),
  );
  /** Escape closes the list until the next keystroke. */
  let suggestionsDismissed = $state(false);
  /** Highlighted suggestion row; -1 means none. */
  let activeSuggestion = $state(-1);
  let pinInput = $state<ReturnType<typeof Input> | null>(null);
  let pinAnchor = $state<HTMLDivElement | null>(null);
  let dialogContent = $state<HTMLElement | null>(null);
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
    if (!loading && !busy && selectedPrincipalId && !selectedPrincipal) selectedPrincipalId = '';
  });

  const pinQuery = $derived(normalizeGithubUserQuery(pinLogin));
  const pinSearchable = $derived(pinTypeahead && pinQuery.length >= GITHUB_USER_QUERY_MIN_LENGTH);
  /** The slice caught up with the input; anything else is stale or pending. */
  const suggestionsCurrent = $derived(pinSearchable && userSearchQuery === pinQuery);
  const visibleSuggestions = $derived(
    suggestionsCurrent ? userSuggestions.slice(0, MAX_USER_SUGGESTIONS) : [],
  );
  const suggestionsOpen = $derived(
    sharingReady && restricted && pinSearchable && !selectedUser && !suggestionsDismissed,
  );

  $effect(() => {
    if (!sharingReady) {
      closeSelectMenus();
      dismissSuggestions();
    }
  });

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
    restricted = false;
    pendingCopy = null;
    pinLogin = '';
    pinProviderDraft = '';
    pinHostDraft = 'gitlab.com';
    selectedUser = null;
    suggestionsDismissed = false;
    activeSuggestion = -1;
    onSearchUsers?.('');
  }

  function handlePinProviderChange(value: string) {
    if (value === 'gitlab' && !gitlabEnabled) return;
    restricted = value !== 'anyone';
    pinLogin = '';
    pendingCopy = null;
    pinProviderDraft = value === 'github' || value === 'gitlab' ? value : '';
    selectedUser = null;
    suggestionsDismissed = false;
    activeSuggestion = -1;
    onSearchUsers?.('');
  }

  // Reset drafts and pending clipboard intent when the dialog closes or retargets.
  $effect(() => {
    void open;
    void workspaceId;
    untrack(resetPinDraft);
    confirmRemovePrincipalId = null;
    selectedPrincipalId = '';
    closeSelectMenus();
  });
  $effect(() => {
    if (!open || !canManage || !sharingReady || createError) {
      pendingCopy = null;
      return;
    }
    const request = pendingCopy;
    if (!request || creating || !createdLink || createdLink.inviteId === request.previousId) return;
    const invite = findCopyableInvite(
      invites.filter((item) => item.id === createdLink.inviteId),
      inviteLinks,
      request.audience,
    );
    if (!invite) return;
    pendingCopy = null;
    untrack(() => void clearSelectedUser());
    void copyLink(inviteLinks[invite.id]);
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
    dismissSuggestions();
    onSearchUsers?.('');
    await tick();
    pinInput?.focus();
  }

  function createInvite() {
    if (
      !open ||
      !workspaceId ||
      !canManage ||
      creating ||
      pendingCopy ||
      copying ||
      !sharingReady ||
      !recipientReady
    )
      return;
    // Recheck expiry on click, including when the dialog has stayed open a long time.
    const existing = findCopyableInvite(invites, inviteLinks, audience);
    if (existing) {
      void copyLink(inviteLinks[existing.id]);
      return;
    }
    if (atGuestCap || !onCreateInvite) return;
    pendingCopy = { audience: { ...audience }, previousId: createdLink?.inviteId };
    const login = audience.login;
    const pin: InvitePin | undefined =
      login && (hostMembershipSupported || identitySeamSupported)
        ? {
            provider: audience.provider,
            ...(audience.provider === 'gitlab' ? { host: audience.host } : {}),
          }
        : undefined;
    if (pin) onCreateInvite(login, pin);
    else onCreateInvite(login);
  }

  function inviteExistingGuest() {
    if (
      !workspaceId ||
      !canManage ||
      !sharingReady ||
      loading ||
      busy ||
      atGuestCap ||
      !selectedPrincipal
    )
      return;
    onAddMember?.(selectedPrincipal.principalId);
  }

  function principalLabel(principal: HostPrincipal): string {
    return principal.login ? `@${principal.login}` : principal.displayName || principal.principalId;
  }

  async function copyLink(url: string) {
    copying = true;
    try {
      await navigator.clipboard.writeText(url);
      notify.success(m.workspace_share_linkCopied_toast());
    } catch {
      notify.error(m.workspace_share_linkCopyFailed_error());
    } finally {
      copying = false;
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
    if (
      !workspaceId ||
      !canManage ||
      busy ||
      principalId === ownerPrincipalId ||
      pendingRolePrincipalIds.includes(principalId) ||
      confirmRemovePrincipalId !== principalId
    )
      return;
    confirmRemovePrincipalId = null;
    onRemoveMember?.(principalId);
  }

  function memberName(member: WorkspaceMember): string {
    return member.displayName || member.login || member.principalId;
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
    if (e.key === 'Escape' && selectMenuOpen) {
      e.preventDefault();
      e.stopPropagation();
      closeSelectMenus();
    }
  }
</script>

{#snippet userAvatar(user: GithubUserSearchItem, size: number = 24)}
  <PrincipalAvatar avatarUrl={user.avatarUrl} label={user.login} {size} testid="share-pin-avatar" />
{/snippet}

{#if open}
  <ContentDialog
    {open}
    bind:contentRef={dialogContent}
    title={sharingReady && workspaceTitle
      ? m.workspace_share_namedTitle_label({ title: workspaceTitle })
      : m.workspace_share_dialog_title()}
    titleId="share-workspace-title"
    closeLabel={m.workspace_share_close_ariaLabel()}
    onClose={() => onClose?.()}
    onkeydowncapture={handleKeydown}
  >
    <div use:animatedHeight={{ tier: 'moderate' }} data-testid="share-dialog-height">
      <div class="space-y-4.5 min-w-0" data-testid="share-workspace-dialog">
        {#if !canManage}
          <p class="text-sm text-subtle" role="status" data-testid="share-owner-only">
            {m.workspace_share_ownerOnly_notice()}
          </p>
        {:else}
          {#if !forgeConnected && canAdministerHost}
            <div
              class="flex flex-col items-start gap-3 rounded border border-border bg-muted/50 p-4"
              data-testid="share-github-required"
            >
              <div class="flex items-center gap-2 text-sm font-medium">
                <Fa icon={faGithub} />
                {#if gitlabEnabled}<Fa icon={faGitlab} />{/if}
                {gitlabEnabled
                  ? m.workspace_share_forgeRequired_title()
                  : m.workspace_share_githubRequired_title()}
              </div>
              <p class="text-sm text-subtle">
                {gitlabEnabled
                  ? m.workspace_share_forgeRequired_description()
                  : m.workspace_share_githubRequired_description()}
              </p>
              <div class="flex items-center gap-2">
                <Button
                  variant="primary"
                  style={sharingActionStyle}
                  size="sm"
                  onclick={() => onConnectGitHub?.()}
                >
                  {m.workspace_share_connectGithub_label()}
                </Button>
                {#if gitlabEnabled}
                  <Button variant="ghost-light" size="sm" onclick={() => onOpenConnections?.()}>
                    {m.workspace_share_openConnections_label()}
                  </Button>
                {/if}
              </div>
            </div>
          {/if}
          {#if !sharingReady}
            <p class="text-sm text-subtle">
              {m.workspace_share_dialog_description({ title: workspaceTitle })}
            </p>
          {/if}

          {#if (canAdministerHost && sharingEnabled !== true) || sharingEnabled === false || sharingEnabling || sharingError}
            <WorkspaceSharingSetup
              {canAdministerHost}
              {sharingEnabled}
              {sharingChecking}
              {sharingEnabling}
              {sharingError}
              {onEnableSharing}
            />
          {/if}

          <div
            hidden={!sharingReady}
            inert={!sharingReady}
            class="space-y-4.5"
            data-testid="share-invite-controls"
          >
            {#if principals.length > 0 || loading || selectedPrincipalId}
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
                      disabled={busy || loading}
                    >
                      <Select.Trigger
                        id="share-existing-guest"
                        aria-busy={loading || busy}
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
                    variant="primary"
                    style={sharingActionStyle}
                    size="sm"
                    disabled={!selectedPrincipal || loading || busy || atGuestCap}
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
                {#if loading}<p role="status" class="text-xs text-subtle">
                    {m.workspace_share_loading_label()}
                  </p>{/if}
              </section>
            {/if}

            <form
              class="space-y-2"
              onsubmit={(e) => {
                e.preventDefault();
                createInvite();
              }}
            >
              <div class="flex flex-wrap items-center gap-2">
                <div class={restricted ? 'w-full' : 'min-w-0 flex-1 basis-60'}>
                  <Select.Root
                    bind:open={pinProviderMenuOpen}
                    value={audienceValue}
                    onchange={handlePinProviderChange}
                    items={audienceItems}
                    disabled={creating || !!pendingCopy || copying}
                  >
                    <Select.Trigger
                      aria-label={m.workspace_share_audience_ariaLabel()}
                      data-testid="share-audience-trigger"
                    >
                      <Fa
                        icon={restricted
                          ? pinProvider === 'gitlab'
                            ? faGitlab
                            : faGithub
                          : faGlobe}
                      />
                      <Select.Value />
                    </Select.Trigger>
                    <Select.Content class="z-(--layer-modal)">
                      {#each audienceItems as item (item.value)}
                        <Select.Item
                          value={item.value}
                          label={item.label}
                          disabled={item.value === 'gitlab' && !gitlabEnabled}
                        >
                          <span class="flex min-w-0 items-center gap-2">
                            <Fa icon={item.icon} />
                            <span class="truncate">{item.label}</span>
                          </span>
                        </Select.Item>
                      {/each}
                    </Select.Content>
                  </Select.Root>
                </div>
                {#if restricted && hostMembershipSupported && pinProvider === 'gitlab'}
                  <div class="w-full space-y-2">
                    <Label for="share-pin-host">{m.collaboration_pin_instance_label()}</Label>
                    <Input
                      id="share-pin-host"
                      bind:value={pinHostDraft}
                      disabled={creating || !!pendingCopy}
                    />
                  </div>
                {/if}
                {#if restricted && forgeConnected}
                  {#if selectedUser}
                    <div
                      class="flex h-(--control-height-medium) min-w-0 flex-1 basis-60 items-center gap-2 rounded-(--radius-medium) border border-border bg-card px-2"
                      role="group"
                      aria-label={m.workspace_share_pinLogin_placeholder()}
                      data-testid="share-pin-selected"
                      data-login={selectedUser.login}
                    >
                      <span
                        class="flex min-w-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5"
                      >
                        {@render userAvatar(selectedUser, 18)}
                        <span class="min-w-0 truncate text-xs">@{selectedUser.login}</span>
                        <Button
                          variant="ghost-light"
                          size="icon-compact"
                          iconOnly
                          class="size-4 rounded-full [&_svg]:size-3"
                          disabled={creating || !!pendingCopy}
                          onclick={() => void clearSelectedUser()}
                          aria-label={m.workspace_share_pinSelected_clear_ariaLabel({
                            login: `@${selectedUser.login}`,
                          })}
                        >
                          <Fa icon={faXmark} size="xs" />
                        </Button>
                      </span>
                    </div>
                  {:else}
                    <Popover.Root
                      open={suggestionsOpen}
                      onOpenChange={(next) => {
                        if (!next) dismissSuggestions();
                      }}
                    >
                      <div bind:this={pinAnchor} class="min-w-0 flex-1 basis-60">
                        <Input
                          id="share-pin-login"
                          aria-label={pinProvider === 'gitlab'
                            ? m.workspace_share_pinLogin_gitlab_placeholder()
                            : m.workspace_share_pinLogin_placeholder()}
                          bind:this={pinInput}
                          bind:value={pinLogin}
                          autocomplete="off"
                          spellcheck={false}
                          disabled={creating || !!pendingCopy}
                          placeholder={pinProvider === 'github'
                            ? m.workspace_share_pinLogin_placeholder()
                            : m.workspace_share_pinLogin_gitlab_placeholder()}
                          role="combobox"
                          aria-autocomplete="list"
                          aria-controls="share-pin-suggestions"
                          aria-expanded={suggestionsOpen}
                          aria-activedescendant={suggestionsOpen &&
                          visibleSuggestions[activeSuggestion]
                            ? `share-pin-suggestion-${activeSuggestion}`
                            : undefined}
                          oninput={(e) => handlePinInput(e.currentTarget.value)}
                          onkeydown={handlePinKeydown}
                        />
                        <Popover.Content
                          portalProps={{ to: dialogContent ?? undefined }}
                          customAnchor={pinAnchor}
                          collisionBoundary={dialogContent}
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
                {/if}
                <Button
                  type="submit"
                  variant="primary"
                  style={sharingActionStyle}
                  loading={creating || !!pendingCopy || copying}
                  aria-label={creating || pendingCopy
                    ? m.workspace_share_creating_label()
                    : undefined}
                  data-testid="share-link-submit"
                  disabled={!sharingReady ||
                    creating ||
                    !!pendingCopy ||
                    copying ||
                    !recipientReady ||
                    (atGuestCap && !matchingInvite)}
                  title={atGuestCap && !matchingInvite
                    ? m.workspace_share_guestLimitReached_notice()
                    : undefined}
                >
                  {linkActionLabel}
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
          </div>

          {#if loadError}
            <p class="text-sm text-danger" role="alert">{loadError}</p>
          {/if}
          {#if actionError}
            <p class="text-sm text-danger" role="alert" data-testid="share-action-error">
              {actionError}
            </p>
          {/if}

          <section class="space-y-4.5" aria-label={m.workspace_share_members_label()}>
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
                  {m.workspace_share_guestCount_label({
                    count: formatInteger(guestCount),
                    limit: formatInteger(guestLimit),
                  })}
                </span>
              {/if}
            </div>
            <div class="space-y-2">
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
                  class="overflow-visible rounded-lg border border-border"
                >
                  {#snippet row({ item: member })}
                    <ShareWorkspaceMemberRow
                      {member}
                      {ownerPrincipalId}
                      editable={canSetMemberRole && !!workspaceId}
                      disabled={loading || removingPrincipalId === member.principalId}
                      removeDisabled={busy}
                      pending={pendingRolePrincipalIds.includes(member.principalId)}
                      error={roleErrors[member.principalId]}
                      bind:confirmRemovePrincipalId
                      onSetRole={onSetMemberRole}
                      onRemoveMember={confirmRemoveMember}
                    />
                  {/snippet}
                </ListView>
              {/if}
              {#if invites.length > 0}
                <section class="space-y-2" aria-label={m.workspace_share_openInvites_label()}>
                  <ListView
                    virtualize={false}
                    items={invites}
                    getKey={(invite) => invite.id}
                    getText={(invite) => inviteAudience(invite)}
                    ariaLabel={m.workspace_share_openInvites_label()}
                    class="overflow-visible rounded-lg border border-border"
                  >
                    {#snippet row({ item: invite })}
                      <div
                        class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
                        data-testid="share-invite-row"
                        data-invite-id={invite.id}
                      >
                        <div class="min-w-0 flex-1 basis-40">
                          <div class="flex items-center gap-3">
                            <PrincipalAvatar
                              label={invite.pinLogin ?? inviteAudience(invite)}
                              size={32}
                            />
                            <div class="min-w-0">
                              <div class="break-words text-sm">
                                {invite.pinLogin ? `@${invite.pinLogin}` : inviteAudience(invite)}
                              </div>
                              <div
                                class="flex items-center gap-1 text-xs text-subtle"
                                data-testid="share-invite-detail"
                                title={inviteDetail(invite)}
                              >
                                <Fa
                                  icon={invite.pinLogin
                                    ? invite.pinIdentity?.provider === 'gitlab'
                                      ? faGitlab
                                      : faGithub
                                    : faGlobe}
                                  size="xs"
                                />
                                {#if invite.pinLogin}
                                  {m.workspace_share_invited_label()}
                                  {#if invite.pinIdentity?.provider === 'gitlab'}<span
                                      >· {invite.pinIdentity.host}</span
                                    >{/if}
                                {:else}{inviteDetail(invite)}{/if}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div class="ml-auto flex shrink-0 items-center gap-1">
                          <Button
                            variant="ghost-light"
                            size="icon-compact"
                            iconOnly
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
                          </Button>
                          <Button
                            variant="ghost-light"
                            size="icon-compact"
                            iconOnly
                            disabled={busy}
                            onclick={() => revokeInvite(invite.id)}
                            aria-label={m.workspace_share_revoke_ariaLabel({
                              audience: inviteAudience(invite),
                            })}
                          >
                            <Fa icon={faXmark} />
                          </Button>
                        </div>
                      </div>
                    {/snippet}
                  </ListView>
                </section>
              {/if}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </ContentDialog>
{/if}
