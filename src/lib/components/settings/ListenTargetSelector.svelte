<script lang="ts">
  /**
   * Listen-target selector (mirrors the `intentd pair` picker): the daemon's
   * available IP addresses with the currently bound ones selected, plus a
   * "Tailcat tunnel" entry. Presentational — the parent owns fetching and
   * persistence (`server.bindAddress`, `server.tunnel.enabled`,
   * `server.tunnel.only`).
   *
   * Selection semantics:
   * - IPs only            → bindAddress=[ips], tunnel.enabled=false
   * - IPs + tunnel        → bindAddress=[ips], tunnel.enabled=true, tunnel.only=false
   * - tunnel only         → tunnel.enabled=true, tunnel.only=true (no direct listeners)
   * - "All interfaces" (0.0.0.0) is exclusive with specific IPs (daemon
   *   validation: unspecified-only-alone).
   */
  import { m } from '$shared/paraglide/messages.js';

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
    /** `server.tunnel.enabled` — tunnel entry selected. */
    tunnelSelected: boolean;
    /** Daemon supports the tunnel settings (degradation gate). */
    tunnelSupported: boolean;
    /** Persist in flight — disables the checkboxes. */
    saving?: boolean;
    onchange: (selection: ListenTargetSelection) => void;
  }

  const { availableIps, selectedIps, tunnelSelected, tunnelSupported, saving, onchange }: Props =
    $props();

  const ALL_INTERFACES = '0.0.0.0';

  // Render the union of available and currently bound IPs so a bound address
  // missing from the live enumeration (e.g. interface down) stays visible and
  // deselectable instead of silently dropping from the persisted value.
  const ipOptions = $derived([
    ALL_INTERFACES,
    ...new Set([...availableIps, ...selectedIps].filter((ip) => ip !== ALL_INTERFACES)),
  ]);

  const selection = $derived(new Set(selectedIps));
  const selectionCount = $derived(selectedIps.length + (tunnelSelected ? 1 : 0));

  function toggleIp(ip: string): void {
    let ips: string[];
    if (selection.has(ip)) {
      ips = selectedIps.filter((v) => v !== ip);
    } else if (ip === ALL_INTERFACES) {
      // Unspecified bind must stand alone.
      ips = [ALL_INTERFACES];
    } else {
      ips = [...selectedIps.filter((v) => v !== ALL_INTERFACES), ip];
    }
    if (ips.length === 0 && !tunnelSelected) return; // never allow zero targets
    onchange({ ips, tunnel: tunnelSelected });
  }

  function toggleTunnel(): void {
    if (tunnelSelected && selectedIps.length === 0) return; // never allow zero targets
    onchange({ ips: selectedIps, tunnel: !tunnelSelected });
  }
</script>

<div class="flex flex-col gap-1" data-listen-target-selector>
  <p class="text-sm font-medium text-foreground">{m.settings_listenTargets_label()}</p>
  <p class="text-xs text-subtle mb-1">{m.settings_listenTargets_description()}</p>
  <ul class="flex flex-col gap-0.5">
    {#each ipOptions as ip (ip)}
      {@const checked = selection.has(ip)}
      <li>
        <label
          class="flex items-center gap-2 py-1 text-sm text-foreground cursor-pointer {saving
            ? 'opacity-50'
            : ''}"
        >
          <input
            type="checkbox"
            {checked}
            disabled={saving || (checked && selectionCount <= 1)}
            onchange={() => toggleIp(ip)}
            class="accent-primary"
          />
          <span class="font-mono text-xs">
            {ip === ALL_INTERFACES ? m.settings_listenTargets_allInterfaces_label() : ip}
          </span>
        </label>
      </li>
    {/each}
    {#if tunnelSupported}
      <li>
        <label
          class="flex items-center gap-2 py-1 text-sm text-foreground cursor-pointer {saving
            ? 'opacity-50'
            : ''}"
          data-listen-target-tunnel
        >
          <input
            type="checkbox"
            checked={tunnelSelected}
            disabled={saving || (tunnelSelected && selectionCount <= 1)}
            onchange={toggleTunnel}
            class="accent-primary"
          />
          <span class="text-xs">{m.settings_listenTargets_tunnel_label()}</span>
        </label>
        {#if tunnelSelected && selectedIps.length === 0}
          <p class="text-xs text-subtle ml-6">{m.settings_listenTargets_tunnelOnly_note()}</p>
        {/if}
      </li>
    {/if}
  </ul>
</div>
