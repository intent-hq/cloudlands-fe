<script lang="ts">
  import { tick } from 'svelte';
  import { menuItem } from '$lib/components/ui/menu';
  import * as Popover from '$lib/components/ui/popover';
  import PrincipalAvatar from '$lib/components/ui/PrincipalAvatar.svelte';
  import type {
    InvitationAccount,
    InvitationAccountQuery,
    InvitationAccountSuggestions,
  } from './invitation-account-search-types';
  import { ContentDialog } from '$lib/components/patterns/confirm';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Select } from '$lib/components/ui/select';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { canonicalInviteHost } from '$features/workspace-sharing/utils/invite-pin';
  import { m } from '$shared/paraglide/messages.js';
  import type { HostInviteInput } from './types';

  let {
    busy = false,
    creating = busy,
    error = null,
    gitlabEnabled = false,
    createdLink = null,
    searchSupported = false,
    search,
    searchEpoch = null,
    onSearch,
    onCreate,
    onCopy,
    onClose,
  }: {
    busy?: boolean;
    creating?: boolean;
    error?: string | null;
    gitlabEnabled?: boolean;
    createdLink?: string | null;
    searchSupported?: boolean;
    search?: InvitationAccountSuggestions;
    searchEpoch?: string | null;
    onSearch?: (query: InvitationAccountQuery | null) => void;
    onCreate: (input: HostInviteInput) => void;
    onCopy: () => void;
    onClose: () => void;
  } = $props();
  const id = $props.id();
  let dialogContent = $state<HTMLElement | null>(null);
  let anchor = $state<HTMLDivElement | null>(null);
  let suggestionList = $state<HTMLDivElement | null>(null);
  let selected = $state<InvitationAccount | null>(null);
  let dismissed = $state(false);
  let active = $state(-1);
  let provider = $state('github');
  let account = $state('');
  let host = $state('gitlab.com');
  let consent = $state(false);
  let accountInput = $state<HTMLInputElement | null>(null);
  const pinProvider = $derived(provider === 'gitlab' ? 'gitlab' : 'github');
  const pinHost = $derived(
    canonicalInviteHost(pinProvider, provider === 'gitlab' ? host : 'github.com'),
  );
  const query = $derived(account.trim().replace(/^@/, ''));
  const matches = $derived(
    search?.request?.query === query &&
      search.request.provider === pinProvider &&
      search.request.host === pinHost,
  );
  const users = $derived(
    matches && !busy
      ? (search?.users ?? [])
          .filter(
            (user) => user.identity.provider === pinProvider && user.identity.host === pinHost,
          )
          .slice(0, 8)
      : [],
  );
  const suggestionsOpen = $derived(
    searchSupported && !busy && !!pinHost && query.length >= 2 && !selected && !dismissed,
  );
  $effect(() => {
    // Retire suggestion metadata on authority revalidation without erasing the draft.
    void searchEpoch;
    void busy;
    selected = null;
    dismissed = true;
    active = -1;
  });
  $effect(() => {
    if (suggestionsOpen && active >= 0)
      suggestionList?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  });
  function dismissSuggestions() {
    dismissed = true;
    active = -1;
  }
  function changed() {
    selected = null;
    consent = false;
    dismissed = false;
    active = -1;
    if (searchSupported)
      onSearch?.(pinHost ? { provider: pinProvider, host: pinHost, query } : null);
  }
  function choose(user: InvitationAccount) {
    if (busy || !suggestionsOpen || !users.includes(user)) return;
    selected = user;
    account = user.login;
    consent = false;
    active = -1;
    onSearch?.(null);
  }
  async function clearSelection() {
    account = '';
    changed();
    await tick();
    accountInput?.focus();
  }
  function keepInputInteraction(event: Event) {
    if (event.target instanceof Node && anchor?.contains(event.target)) event.preventDefault();
  }
  function keydown(event: KeyboardEvent) {
    // Account entry never submits an invitation implicitly.
    if (event.key === 'Enter') {
      event.preventDefault();
      if (suggestionsOpen && users[active]) choose(users[active]);
    }
    if (!suggestionsOpen) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active =
        event.key === 'ArrowDown'
          ? Math.min(active + 1, users.length - 1)
          : Math.max(active - 1, -1);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissSuggestions();
    }
  }
  const providers = $derived([
    { value: 'github', label: m.workspace_share_pinProvider_github_label() },
    { value: 'gitlab', label: m.workspace_share_pinProvider_gitlab_label({ host }) },
  ]);
  const invalid = $derived(
    !account.trim() || !pinHost || (provider === 'gitlab' && !gitlabEnabled),
  );
  $effect(() => {
    if (!gitlabEnabled && provider === 'gitlab') {
      provider = 'github';
      account = '';
      changed();
    }
  });
  function create() {
    if (busy || invalid || !consent || createdLink) return;
    onCreate({ pinLogin: account.trim(), pinProvider, pinHost: pinHost! });
  }
</script>

<ContentDialog
  open
  bind:contentRef={dialogContent}
  title={m.collaboration_host_inviteDialog_title()}
  description={m.collaboration_host_invite_description()}
  initialFocus={accountInput}
  {busy}
  dismissOnInteractOutside={false}
  {onClose}
>
  <div class="min-w-0 space-y-5">
    {#if createdLink}
      <div class="min-w-0 space-y-3 rounded border border-border bg-muted/50 p-3" role="status">
        <p class="type-body font-medium">{m.workspace_share_newLink_label()}</p>
        <code class="block break-all text-xs">{createdLink}</code>
        <Button variant="secondary" disabled={busy} onclick={onCopy}
          >{m.workspace_share_copyLink_label()}</Button
        >
      </div>
    {:else}
      {#if gitlabEnabled}
        <div class="space-y-2">
          <Label for={`${id}-provider`}>{m.collaboration_pin_provider_label()}</Label>
          <Select.Root
            bind:value={provider}
            items={providers}
            disabled={busy}
            onchange={(value) => {
              provider = value;
              account = '';
              changed();
            }}
          >
            <Select.Trigger id={`${id}-provider`}><Select.Value /></Select.Trigger>
            <Select.Content>
              {#each providers as item}
                <Select.Item value={item.value} label={item.label}>{item.label}</Select.Item>
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
      {/if}
      {#if provider === 'gitlab'}
        <div class="space-y-2">
          <Label for={`${id}-host`}>{m.collaboration_pin_instance_label()}</Label>
          <Input
            id={`${id}-host`}
            bind:value={host}
            disabled={busy}
            oninput={(event) => {
              host = event.currentTarget.value;
              changed();
            }}
          />
          {#if !pinHost}<p class="type-caption text-danger" role="alert">
              {m.collaboration_pin_invalid_error()}
            </p>{/if}
        </div>
      {/if}
      <div class="space-y-2">
        <Label id={`${id}-account-label`} for={`${id}-account`}
          >{m.collaboration_pin_account_label()}</Label
        >
        {#if selected}
          <div
            role="group"
            aria-labelledby={`${id}-account-label`}
            class="flex min-w-0 items-center gap-2 rounded border border-border px-2 py-1"
          >
            <PrincipalAvatar
              avatarUrl={selected.avatarUrl}
              label={selected.name || selected.login}
              size={24}
            />
            <span class="min-w-0 flex-1 truncate type-body"
              >{selected.name ? `${selected.name} · ` : ''}@{selected.login}</span
            >
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={m.workspace_share_pinSelected_clear_ariaLabel({
                login: `@${selected.login}`,
              })}
              onclick={() => void clearSelection()}
              >{m.settings_guestSessions_remove_label()}</Button
            >
          </div>
        {:else}
          <Popover.Root
            open={suggestionsOpen}
            onOpenChange={(open) => {
              if (!open) dismissSuggestions();
            }}
          >
            <div bind:this={anchor} class="min-w-0">
              <Input
                id={`${id}-account`}
                bind:ref={accountInput}
                bind:value={account}
                disabled={busy}
                autocomplete="off"
                spellcheck={false}
                role={searchSupported ? 'combobox' : undefined}
                aria-autocomplete={searchSupported ? 'list' : undefined}
                aria-controls={suggestionsOpen ? `${id}-suggestions` : undefined}
                aria-expanded={searchSupported ? suggestionsOpen : undefined}
                aria-activedescendant={suggestionsOpen && users[active]
                  ? `${id}-suggestion-${active}`
                  : undefined}
                oninput={(event) => {
                  account = event.currentTarget.value;
                  changed();
                }}
                onkeydown={keydown}
              />
              <Popover.Content
                portalProps={{ to: dialogContent ?? undefined }}
                customAnchor={anchor}
                collisionBoundary={dialogContent}
                align="start"
                collisionPadding={8}
                trapFocus={false}
                preventScroll={false}
                onOpenAutoFocus={(event) => event.preventDefault()}
                onCloseAutoFocus={(event) => event.preventDefault()}
                onInteractOutside={keepInputInteraction}
                onFocusOutside={(event) => {
                  keepInputInteraction(event);
                  if (!event.defaultPrevented) dismissSuggestions();
                }}
                onEscapeKeydown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  dismissSuggestions();
                }}
                role="presentation"
                class="z-(--layer-modal) w-(--bits-popover-anchor-width) max-h-[min(18rem,var(--bits-popover-content-available-height))] overflow-y-auto"
              >
                <div
                  bind:this={suggestionList}
                  id={`${id}-suggestions`}
                  role="listbox"
                  aria-label={m.collaboration_accountSearch_suggestions()}
                >
                  {#each users as user, index (user.login)}
                    <Button
                      variant="ghost"
                      id={`${id}-suggestion-${index}`}
                      role="option"
                      aria-selected={index === active}
                      tabindex={-1}
                      class="{menuItem()} h-auto w-full justify-start gap-2 whitespace-normal text-left {index ===
                      active
                        ? 'bg-muted'
                        : ''}"
                      onpointerdown={(event) => event.preventDefault()}
                      onmousemove={() => (active = index)}
                      onclick={() => choose(user)}
                    >
                      <PrincipalAvatar
                        avatarUrl={user.avatarUrl}
                        label={user.name || user.login}
                        size={24}
                      />
                      <span class="min-w-0 break-words"
                        >{user.name ? `${user.name} · ` : ''}@{user.login}</span
                      >
                    </Button>
                  {/each}
                </div>
                {#if matches && search?.error}
                  <p role="alert" class="px-3 py-2 type-caption text-danger">{search.error}</p>
                {:else if !matches || search?.status === 'loading'}
                  <p role="status" class="px-3 py-2 type-caption text-muted-foreground">
                    {m.collaboration_accountSearch_loading()}
                  </p>
                {:else if users.length === 0}
                  <p role="status" class="px-3 py-2 type-caption text-muted-foreground">
                    {m.collaboration_accountSearch_empty()}
                  </p>
                {/if}
              </Popover.Content>
            </div>
          </Popover.Root>
        {/if}
        {#if !searchSupported && !busy}
          <p class="type-caption text-muted-foreground">{m.collaboration_accountSearch_manual()}</p>
        {/if}
      </div>
      <div class="space-y-3 rounded border border-border bg-muted/50 p-3">
        <p id={`${id}-permissions`} class="type-body text-muted-foreground">
          {m.collaboration_host_invite_permissions()}
        </p>
        <div class="flex items-start gap-3">
          <Checkbox
            id={`${id}-consent`}
            bind:checked={consent}
            disabled={busy || invalid}
            ariaDescribedby={`${id}-permissions`}
          />
          <Label for={`${id}-consent`} class="min-w-0 leading-normal"
            >{m.collaboration_host_invite_scope()}</Label
          >
        </div>
      </div>
    {/if}
    {#if error}<p role="alert" class="type-body text-danger">{error}</p>{/if}
  </div>
  {#snippet footer()}
    <Button variant="outline" disabled={busy} onclick={onClose}
      >{createdLink ? m.workspace_share_close_ariaLabel() : m.settings_connections_cancel()}</Button
    >
    {#if !createdLink}
      <Button disabled={busy || invalid || !consent} onclick={create}
        >{creating
          ? m.workspace_share_creating_label()
          : m.workspace_share_createLink_label()}</Button
      >
    {/if}
  {/snippet}
</ContentDialog>
