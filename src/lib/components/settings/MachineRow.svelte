<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';
  import { CONNECTION_ACCENT_CLASSES } from '$lib/utils/connection-accents';
  import { m } from '$shared/paraglide/messages.js';
  import {
    CONNECTION_ACCENTS,
    DEFAULT_CONNECTION_ACCENT,
    type ConnectionAccent,
    type ConnectionOpenStatus,
    type ConnectionRecord,
  } from '$shared/types/connections';
  import { store as appStore } from '$store/renderer/store';
  import { updateConnectionRequested } from '$store/renderer/slices/connections/connections-slice';

  interface Props {
    machine: ConnectionRecord;
    onRequestRemove: (machine: ConnectionRecord) => void;
  }

  let { machine, onRequestRemove }: Props = $props();
  let name = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);

  const accent = $derived(machine.accent ?? DEFAULT_CONNECTION_ACCENT);
  const trimmedName = $derived(name.trim());
  const nameInvalid = $derived(trimmedName.length === 0);
  const nameChanged = $derived(trimmedName !== machine.label);
  const address = $derived(`${machine.host ?? ''}:${machine.port ?? ''}`);
  const openStatus = $derived(machine.status ?? 'not-open');

  $effect(() => {
    if (!saving) name = machine.label;
  });

  function accentLabel(value: ConnectionAccent): string {
    return {
      blue: m.settings_machines_accentBlue_label(),
      indigo: m.settings_machines_accentIndigo_label(),
      violet: m.settings_machines_accentViolet_label(),
      rose: m.settings_machines_accentRose_label(),
      orange: m.settings_machines_accentOrange_label(),
      emerald: m.settings_machines_accentEmerald_label(),
      teal: m.settings_machines_accentTeal_label(),
    }[value];
  }

  function statusLabel(status: ConnectionOpenStatus): string {
    return {
      connecting: m.settings_machines_statusConnecting_label(),
      connected: m.settings_machines_statusConnected_label(),
      disconnected: m.settings_machines_statusDisconnected_label(),
      'not-open': m.settings_machines_statusNotOpen_label(),
    }[status];
  }

  async function update(label: string, nextAccent: ConnectionAccent) {
    saving = true;
    error = null;
    try {
      const action = updateConnectionRequested({ id: machine.id, label, accent: nextAccent });
      appStore.dispatch(action);
      await action.promise;
    } catch {
      error = m.settings_machines_update_error();
    } finally {
      saving = false;
    }
  }

  function saveName() {
    if (!nameInvalid && nameChanged) void update(trimmedName, accent);
  }

  function selectAccent(nextAccent: ConnectionAccent) {
    if (nextAccent !== accent) void update(machine.label, nextAccent);
  }
</script>

<article
  class="rounded-xl border border-border bg-card p-5"
  aria-labelledby={`machine-${machine.id}-name`}
  aria-busy={saving}
>
  <div class="flex items-start gap-4">
    <span
      class={cn(
        'mt-1 size-3 shrink-0 rounded-full ring-2 ring-background outline outline-1 outline-border',
        CONNECTION_ACCENT_CLASSES[accent],
      )}
      aria-hidden="true"
      data-machine-accent={accent}
    ></span>
    <div class="min-w-0 flex-1 space-y-4">
      <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div class="space-y-1.5">
          <label
            id={`machine-${machine.id}-name`}
            for={`machine-${machine.id}-name-input`}
            class="text-xs font-medium text-muted-foreground"
          >
            {m.settings_machines_name_label()}
          </label>
          <div class="flex gap-2">
            <input
              id={`machine-${machine.id}-name-input`}
              class="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              bind:value={name}
              aria-invalid={nameInvalid}
              aria-describedby={nameInvalid ? `machine-${machine.id}-name-error` : undefined}
              disabled={saving}
            />
            <Button onclick={saveName} disabled={saving || nameInvalid || !nameChanged}>
              {saving ? m.settings_machines_saving_label() : m.settings_connections_save()}
            </Button>
          </div>
          {#if nameInvalid}
            <p id={`machine-${machine.id}-name-error`} class="text-xs text-error-foreground">
              {m.settings_machines_nameRequired_error()}
            </p>
          {/if}
        </div>
        <div class="space-y-1 text-sm sm:text-right">
          <p class="font-mono text-xs text-muted-foreground">{address}</p>
          <p
            class="text-xs text-foreground"
            role="status"
            aria-label={m.settings_machines_status_ariaLabel({
              status: statusLabel(openStatus),
            })}
          >
            {statusLabel(openStatus)}
          </p>
        </div>
      </div>

      <fieldset class="space-y-2" disabled={saving}>
        <legend class="text-xs font-medium text-muted-foreground">
          {m.settings_machines_accent_label()}
        </legend>
        <div class="flex flex-wrap gap-2">
          {#each CONNECTION_ACCENTS as option}
            <button
              type="button"
              class={cn(
                'flex size-8 cursor-pointer items-center justify-center rounded-full border bg-background transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                option === accent
                  ? 'border-foreground shadow-[0_0_0_2px_var(--color-background),0_0_0_4px_var(--color-foreground)]'
                  : 'border-border hover:border-input',
              )}
              aria-label={m.settings_machines_accentOption_ariaLabel({
                color: accentLabel(option),
              })}
              aria-pressed={option === accent}
              onclick={() => selectAccent(option)}
            >
              <span
                class={cn('size-4 rounded-full', CONNECTION_ACCENT_CLASSES[option])}
                aria-hidden="true"
              ></span>
            </button>
          {/each}
        </div>
      </fieldset>

      {#if error}
        <p class="text-xs text-error-foreground" role="alert">{error}</p>
      {/if}

      <div class="flex justify-end">
        <Button
          variant="ghost"
          class="text-error-foreground"
          disabled={saving}
          onclick={() => onRequestRemove(machine)}
        >
          {m.settings_machines_remove_label()}
        </Button>
      </div>
    </div>
  </div>
</article>
