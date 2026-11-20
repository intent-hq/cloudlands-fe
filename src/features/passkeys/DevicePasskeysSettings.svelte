<!--
  Settings → Passkeys: device passkeys kept by the browser-panel helper
  (Linux, Intent OS). Presentational; the settings page connects it to the
  device-passkeys slice. Delete always confirms first.
-->
<script lang="ts">
  import { faTrash } from '@fortawesome/free-solid-svg-icons';
  import Fa from 'svelte-fa';
  import { ListRow, ListView } from '$lib/components/patterns/collection';
  import { DestructiveConfirm } from '$lib/components/patterns/confirm';
  import { defineSettings, SettingsForm } from '$lib/components/patterns/settings';
  import { Button, IntentMarkLoader } from '$lib/components/patterns/settings/custom-controls';
  import { formatDate } from '$lib/i18n/format';
  import { m } from '$shared/paraglide/messages.js';
  import type { PasskeyDeviceCredential } from '$shared/ipc/passkeys';
  import type { DevicePasskeysView } from '$store/renderer/slices/device-passkeys/device-passkeys-slice';

  interface Props {
    passkeys: DevicePasskeysView;
    /** Preview only: render the confirm dialog in place, open for this credential. */
    staticConfirmId?: string;
    onRetry: () => void;
    onDelete: (credentialId: string) => void;
  }

  let { passkeys, staticConfirmId, onRetry, onDelete }: Props = $props();

  let pending = $state<PasskeyDeviceCredential | null>(null);
  let confirmOpen = $state(false);
  $effect(() => {
    const entry = passkeys.credentials.find((item) => item.credentialId === staticConfirmId);
    if (entry) {
      pending = entry;
      confirmOpen = true;
    }
  });

  const userLabel = (entry: PasskeyDeviceCredential) => entry.userName || entry.userDisplayName;

  const sorted = $derived(
    [...passkeys.credentials].sort(
      (a, b) => a.rpId.localeCompare(b.rpId) || userLabel(a).localeCompare(userLabel(b)),
    ),
  );

  const failedEntry = $derived(
    passkeys.deleteFailedId
      ? (passkeys.credentials.find((entry) => entry.credentialId === passkeys.deleteFailedId) ??
          null)
      : null,
  );

  const schema = $derived(
    defineSettings({
      sections: [
        {
          id: 'passkeys',
          title: m.passkeys_settings_title(),
          description: m.passkeys_settings_description(),
          entries: [
            {
              id: 'passkeys-list',
              kind: 'custom',
              layout: 'full-width',
              label: m.passkeys_settings_list_ariaLabel(),
              class: 'p-0',
              busy: passkeys.status === 'loading',
              error: failedEntry ? m.passkeys_settings_deleteFailed_error() : undefined,
            },
          ],
        },
      ],
    }),
  );

  function askDelete(entry: PasskeyDeviceCredential) {
    pending = entry;
    confirmOpen = true;
  }

  function confirmDelete() {
    if (pending) onDelete(pending.credentialId);
    confirmOpen = false;
  }
</script>

{#snippet list()}
  {#if passkeys.status === 'loading'}
    <div class="flex justify-center px-6 py-6 text-muted-foreground">
      <IntentMarkLoader size={20} />
    </div>
  {:else if passkeys.status === 'error'}
    <div class="flex items-center justify-between gap-4 px-6 py-4">
      <p class="type-body text-danger" role="alert">{m.passkeys_settings_loadFailed_error()}</p>
      <Button variant="secondary" size="sm" onclick={onRetry}>
        {m.passkeys_settings_retry_label()}
      </Button>
    </div>
  {:else if sorted.length === 0}
    <p class="type-body px-6 py-4 text-muted-foreground" data-testid="device-passkeys-empty">
      {m.passkeys_settings_empty()}
    </p>
  {:else}
    <ListView
      items={sorted}
      getKey={(entry) => entry.credentialId}
      getText={(entry) => `${entry.rpId} ${userLabel(entry)}`}
      ariaLabel={m.passkeys_settings_list_ariaLabel()}
      class="divide-y divide-border"
    >
      {#snippet row({ item })}
        {@const deleting = passkeys.deletingIds.includes(item.credentialId)}
        <ListRow class="px-6 py-3" data-testid="device-passkey-row">
          {#snippet title()}
            <span class="block truncate">{item.rpId}</span>
          {/snippet}
          {#snippet description()}
            <span class="block truncate">
              {userLabel(item)}
              <span aria-hidden="true">·</span>
              {m.passkeys_settings_created_label({ date: formatDate(item.createdAt) })}
              <span aria-hidden="true">·</span>
              {item.lastUsedAt === null
                ? m.passkeys_settings_neverUsed_label()
                : m.passkeys_settings_lastUsed_label({ date: formatDate(item.lastUsedAt) })}
            </span>
          {/snippet}
          {#snippet trailing()}
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={deleting}
              aria-label={`${m.passkeys_settings_delete_label()} ${item.rpId} ${userLabel(item)}`}
              title={m.passkeys_settings_delete_label()}
              onclick={() => askDelete(item)}
            >
              {#if deleting}
                <IntentMarkLoader size={14} />
              {:else}
                <Fa icon={faTrash} fw />
              {/if}
            </Button>
          {/snippet}
        </ListRow>
      {/snippet}
    </ListView>
  {/if}
{/snippet}

<SettingsForm {schema} custom={{ 'passkeys-list': list }} />

{#if pending}
  <DestructiveConfirm
    bind:open={confirmOpen}
    static={staticConfirmId !== undefined}
    title={m.passkeys_settings_deleteConfirm_title({ site: pending.rpId })}
    description={m.passkeys_settings_deleteConfirm_description({
      site: pending.rpId,
      user: userLabel(pending),
    })}
    confirmLabel={m.passkeys_settings_delete_label()}
    onConfirm={confirmDelete}
    onCancel={() => (confirmOpen = false)}
  />
{/if}
