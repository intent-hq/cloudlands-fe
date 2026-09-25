<script lang="ts">
  import { m } from '$shared/paraglide/messages.js';
  import Fa from 'svelte-fa';
  import { faChevronDown } from '@fortawesome/free-solid-svg-icons';
  import { SettingsFieldRow } from '$lib/components/patterns/settings';
  import { Combobox } from '$lib/components/patterns/settings/custom-controls';

  export interface ListenTargetSelection {
    /** Selected bind IPs ('0.0.0.0' means all interfaces, exclusive). */
    ips: string[];
    /** Tailcat tunnel selected. */
    tunnel: boolean;
  }

  interface Props {
    /** Available local IPs (from pairing info / system.status). */
    availableIps: string[];
    /** Currently selected bind IPs (from `server.bindAddress`). */
    selectedIps: string[];
    /** `server.tunnel.enabled` — the parent's tunnel toggle state. */
    tunnelSelected: boolean;
    /** Persist in flight — disables the multiselect. */
    saving?: boolean;
    onchange: (selection: ListenTargetSelection) => void;
  }

  const { availableIps, selectedIps, tunnelSelected, saving, onchange }: Props = $props();

  const ALL_INTERFACES = '0.0.0.0';
  const LOOPBACK = '127.0.0.1';
  // The daemon treats the IPv6 unspecified address like 0.0.0.0 (must stand
  // alone, covers loopback). The selector has no IPv6 UI, so an out-of-band
  // "::" only renders as a plain entry — but never gets loopback appended.
  const UNSPECIFIED = new Set([ALL_INTERFACES, '::']);

  // Render the union of available and currently bound IPs so a bound address
  // missing from the live enumeration (e.g. interface down) stays visible and
  // deselectable instead of silently dropping from the persisted value.
  // Loopback is always listed (and always bound, see below).
  const ipOptions = $derived([
    ALL_INTERFACES,
    LOOPBACK,
    ...new Set(
      [...availableIps, ...selectedIps].filter((ip) => ip !== ALL_INTERFACES && ip !== LOOPBACK),
    ),
  ]);

  const selection = $derived(new Set(selectedIps));
  const allInterfacesSelected = $derived(selectedIps.some((ip) => UNSPECIFIED.has(ip)));
  const renderedSelection = $derived(withLoopback(selectedIps));
  const groups = $derived([
    {
      key: 'all',
      label: '',
      options: [{ value: ALL_INTERFACES, label: ipLabel(ALL_INTERFACES) }],
    },
    {
      key: 'interfaces',
      label: '',
      separatorBefore: true,
      options: ipOptions
        .filter((ip) => ip !== ALL_INTERFACES)
        .map((ip) => ({
          value: ip,
          label: ipLabel(ip),
          disabled: ip === LOOPBACK && !allInterfacesSelected,
        })),
    },
  ]);
  const displayValue = $derived(renderedSelection.map(ipLabel).join(', '));

  function ipLabel(ip: string): string {
    return ip === ALL_INTERFACES
      ? m.settings_listenTargets_allInterfaces_label()
      : ip === LOOPBACK
        ? m.settings_listenTargets_loopback_label()
        : ip;
  }

  /**
   * Loopback is always bound: force it into every emission unless an
   * unspecified address (which already covers it) is selected. This also
   * means a selection can never be empty — unchecking the last specific IP
   * (or all-interfaces) lands on loopback-only.
   */
  function withLoopback(ips: string[]): string[] {
    if (ips.some((ip) => UNSPECIFIED.has(ip)) || ips.includes(LOOPBACK)) return ips;
    return [...ips, LOOPBACK];
  }

  function toggleIp(ip: string): void {
    if (ip === LOOPBACK && !allInterfacesSelected) return; // always bound
    let ips: string[];
    if (selection.has(ip)) {
      ips = selectedIps.filter((v) => v !== ip);
    } else if (ip === ALL_INTERFACES) {
      // Unspecified bind must stand alone.
      ips = [ALL_INTERFACES];
    } else {
      ips = [...selectedIps.filter((v) => !UNSPECIFIED.has(v)), ip];
    }
    onchange({ ips: withLoopback(ips), tunnel: tunnelSelected });
  }

  function handleChange(next: string | string[]): void {
    if (saving || !Array.isArray(next)) return;
    const changed = ipOptions.find((ip) => next.includes(ip) !== renderedSelection.includes(ip));
    if (changed) toggleIp(changed);
  }
</script>

<SettingsFieldRow
  id="available-networks"
  label={m.settings_listenTargets_label()}
  description={m.settings_listenTargets_description()}
  disabled={saving}
>
  {#snippet control()}
    <div class="relative w-full md:w-64">
      <Combobox
        multiple
        bind:value={() => renderedSelection, () => {}}
        {groups}
        {displayValue}
        disabled={saving}
        ariaLabel={m.settings_listenTargets_label()}
        inputClass="pr-8"
        onchange={handleChange}
      />
      <span
        class="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      >
        <Fa icon={faChevronDown} />
      </span>
    </div>
    {#if tunnelSelected && selectedIps.length === 0}
      <p class="type-body text-subtle mt-2 md:max-w-64">
        {m.settings_listenTargets_tunnelOnly_note()}
      </p>
    {/if}
  {/snippet}
</SettingsFieldRow>
