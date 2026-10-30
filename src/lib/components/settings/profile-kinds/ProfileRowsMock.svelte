<script lang="ts">
  /**
   * Mock-up of a provider's profile rows (fake data, no store): the pinned
   * Default row, "Signed in as <email>" on Claude rows, and the ⋯ menu with
   * Log In for Different-login profiles only. Remove opens the confirmation
   * that names a Different-login profile's folder. Wiring moves these pieces
   * into ProviderProfiles.svelte.
   */
  import { onDestroy } from 'svelte';
  import {
    faUser,
    faArrowsRotate,
    faCheck,
    faPen,
    faTrash,
    faTriangleExclamation,
  } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { m } from '$shared/paraglide/messages.js';
  import {
    Button,
    IntentMarkLoader,
    Menu,
  } from '$lib/components/patterns/settings/custom-controls';
  import KebabIcon from '$lib/components/icons/KebabIcon.svelte';
  import ProfileDeleteConfirm from './ProfileDeleteConfirm.svelte';
  import type { MockProfileRow, MockProfileStatus, ProfileKindProvider } from './profile-kind-mock';

  interface Props {
    provider: ProfileKindProvider;
    providerName: string;
    defaultStatus?: MockProfileStatus;
    /** Claude: the Default configuration's signed-in account. */
    defaultEmail?: string;
    rows: MockProfileRow[];
    /** The row whose ⋯ menu is open (scenes). */
    menuOpenFor?: string;
    /** Render menus in place (previews), so a screenshot captures them. */
    staticMenus?: boolean;
    onEdit?: (row: MockProfileRow) => void;
    onLogIn?: (row: MockProfileRow) => void;
  }

  let {
    provider,
    providerName,
    defaultStatus = 'ready',
    defaultEmail,
    rows = $bindable(),
    menuOpenFor = $bindable(),
    staticMenus = false,
    onEdit,
    onLogIn,
  }: Props = $props();

  let removing = $state<MockProfileRow | undefined>();
  let confirmOpen = $state(false);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  onDestroy(() => timers.forEach(clearTimeout));

  function setStatus(id: string, status: MockProfileStatus) {
    rows = rows.map((row) => (row.id === id ? { ...row, status } : row));
  }

  /** Mock Log In: Checking…, then Ready (the real flow opens the terminal sign-in). */
  function logIn(row: MockProfileRow) {
    if (onLogIn) {
      onLogIn(row);
      return;
    }
    setStatus(row.id, 'checking');
    const timer = setTimeout(() => {
      timers.delete(timer);
      setStatus(row.id, 'ready');
    }, 1200);
    timers.add(timer);
  }

  function askRemove(row: MockProfileRow) {
    removing = row;
    confirmOpen = true;
  }

  function menuOpenChange(id: string, open: boolean) {
    if (open) menuOpenFor = id;
    else if (menuOpenFor === id) menuOpenFor = undefined;
  }
</script>

<section
  class="space-y-2"
  aria-label={m.settings_providerProfiles_section_ariaLabel({ provider: providerName })}
  data-testid="provider-profile-rows-mock"
>
  <ul class="divide-y divide-border rounded-lg border border-border">
    <li class="px-3 py-2" data-testid="provider-default-row">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <span class="truncate type-body text-foreground"
            >{m.chat_modelPicker_defaultProfile_name()}</span
          >
          {@render identity(provider === 'claude' ? defaultEmail : undefined)}
        </div>
        <div class="flex shrink-0 items-center gap-2 type-caption">
          {@render statusLabel(defaultStatus)}
        </div>
      </div>
    </li>
    {#each rows as row (row.id)}
      <li class="px-3 py-2" data-testid="provider-profile-row" data-kind={row.kind}>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="flex min-w-0 items-center gap-2">
              <span class="truncate type-body text-foreground" title={row.name}>{row.name}</span>
              {#if row.backup}
                <span class="shrink-0 rounded-full bg-muted px-2 py-0.5 type-caption text-subtle">
                  {m.settings_providerProfiles_backupBadge_label()}
                </span>
              {/if}
            </div>
            {@render identity(
              provider === 'claude' && row.status === 'ready' ? row.email : undefined,
            )}
          </div>
          <div class="flex shrink-0 items-center gap-2 type-caption">
            {@render statusLabel(row.status)}
            <Menu.Root
              open={menuOpenFor === row.id}
              staticPosition={staticMenus}
              onOpenChange={(open: boolean) => menuOpenChange(row.id, open)}
            >
              <Menu.Trigger>
                {#snippet child({ props })}
                  <Button
                    {...props}
                    variant="ghost-light"
                    size="icon-xs"
                    aria-label={m.settings_providerProfiles_actions_ariaLabel({ name: row.name })}
                  >
                    <KebabIcon class="size-3.5" />
                  </Button>
                {/snippet}
              </Menu.Trigger>
              <Menu.Content
                align="end"
                aria-label={m.settings_providerProfiles_actions_ariaLabel({ name: row.name })}
              >
                <div class="w-56" data-testid="provider-profile-row-menu">
                  <Menu.Item class="cursor-pointer text-foreground" onSelect={() => onEdit?.(row)}>
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Fa icon={faPen} class="size-3.5 text-muted-foreground" />
                    </span>
                    {m.settings_providerProfiles_edit_label()}
                  </Menu.Item>
                  {#if row.kind === 'differentLogin' && row.folderPath}
                    <Menu.Item
                      class="cursor-pointer text-foreground"
                      disabled={row.status === 'checking'}
                      onSelect={() => logIn(row)}
                      data-testid="provider-profile-row-log-in"
                    >
                      <span class="flex size-4 shrink-0 items-center justify-center">
                        <Fa icon={faUser} class="size-3.5 text-muted-foreground" />
                      </span>
                      {m.settings_providerProfileKinds_logIn_label()}
                    </Menu.Item>
                  {/if}
                  <Menu.Item
                    class="cursor-pointer text-foreground"
                    disabled={row.status === 'checking'}
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Fa icon={faArrowsRotate} class="size-3.5 text-muted-foreground" />
                    </span>
                    {m.settings_providers_recheck_label()}
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item class="cursor-pointer text-foreground" onSelect={() => askRemove(row)}>
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Fa icon={faTrash} class="size-3.5 text-muted-foreground" />
                    </span>
                    {m.settings_providerProfiles_remove_label()}
                  </Menu.Item>
                </div>
              </Menu.Content>
            </Menu.Root>
          </div>
        </div>
      </li>
    {/each}
  </ul>
</section>

{#if removing}
  <ProfileDeleteConfirm
    bind:open={confirmOpen}
    profileName={removing.name}
    folderPath={removing.kind === 'differentLogin' ? removing.folderPath : undefined}
    onConfirm={() => (rows = rows.filter((row) => row.id !== removing?.id))}
  />
{/if}

{#snippet identity(email: string | undefined)}
  {#if email}
    <p class="truncate type-caption text-muted-foreground" data-testid="provider-profile-identity">
      {m.settings_providerProfileKinds_signedInAs_label({ email })}
    </p>
  {/if}
{/snippet}

{#snippet statusLabel(status: MockProfileStatus)}
  <span
    role="status"
    class="flex items-center gap-1 {status === 'error' ? 'text-warning-ink' : 'text-subtle'}"
    data-profile-status={status}
  >
    {#if status === 'checking'}
      <IntentMarkLoader size={12} class="text-muted-foreground" />
      {m.settings_providerProfiles_statusChecking_label()}
    {:else if status === 'ready'}
      <Fa icon={faCheck} class="size-3 text-success" />
      {m.settings_providerProfiles_statusReady_label()}
    {:else if status === 'error'}
      <Fa icon={faTriangleExclamation} class="size-3" />
      {m.settings_providerProfiles_statusError_label()}
    {:else}
      {m.settings_providerProfiles_statusConfigured_label()}
    {/if}
  </span>
{/snippet}
