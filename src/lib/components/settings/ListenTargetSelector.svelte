<script lang="ts">
  /**
   * Listen-target selector (mirrors the `intentd pair` picker): the daemon's
   * available IP addresses with the currently bound ones selected.
   * Presentational — the parent owns fetching and persistence
   * (`server.bindAddress`, `server.tunnel.enabled`, `server.tunnel.only`)
   * and hosts the tunnel on/off toggle; `tunnelSelected` mirrors it here.
   *
   * Selection semantics:
   * - "127.0.0.1 (localhost)" is always bound: this app and the tailcat
   *   sidecar (which forwards tunnel connections to 127.0.0.1:<port>) reach
   *   the daemon over loopback, so it renders checked + locked and every
   *   emission includes it — except under all-interfaces, which covers it.
   * - "All interfaces" (0.0.0.0) is exclusive with specific IPs (daemon
   *   validation: unspecified-only-alone). While it is selected, the other
   *   addresses render checked but locked (0.0.0.0 already covers them);
   *   unchecking it falls back to loopback-only and makes them individually
   *   toggleable again.
   * - Specific IPs are hand-picked on top of loopback; deselecting the last
   *   one leaves loopback-only (never zero targets), and the parent keeps
   *   the section open so more IPs can be picked.
   * - The tunnel toggle lives in the parent; its state is carried through.
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
    /** `server.tunnel.enabled` — the parent's tunnel toggle state. */
    tunnelSelected: boolean;
    /** Persist in flight — disables the checkboxes. */
    saving?: boolean;
    onchange: (selection: ListenTargetSelection) => void;
  }

  const { availableIps, selectedIps, tunnelSelected, saving, onchange }: Props = $props();

  const ALL_INTERFACES = '0.0.0.0';
  const LOOPBACK = '127.0.0.1';

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

  // While all-interfaces is bound, every other address is already covered by
  // 0.0.0.0 — render them checked but locked until all-interfaces is
  // unchecked.
  const allInterfacesSelected = $derived(selection.has(ALL_INTERFACES));

  /**
   * Loopback is always bound: force it into every emission unless
   * all-interfaces (which already covers it) is selected. This also means a
   * selection can never be empty — unchecking the last specific IP (or
   * all-interfaces) lands on loopback-only.
   */
  function withLoopback(ips: string[]): string[] {
    if (ips.includes(ALL_INTERFACES) || ips.includes(LOOPBACK)) return ips;
    return [...ips, LOOPBACK];
  }

  function toggleIp(ip: string): void {
    if (ip === LOOPBACK) return; // always bound, never toggled
    let ips: string[];
    if (selection.has(ip)) {
      ips = selectedIps.filter((v) => v !== ip);
    } else if (ip === ALL_INTERFACES) {
      // Unspecified bind must stand alone.
      ips = [ALL_INTERFACES];
    } else {
      ips = [...selectedIps.filter((v) => v !== ALL_INTERFACES), ip];
    }
    onchange({ ips: withLoopback(ips), tunnel: tunnelSelected });
  }
</script>

<div class="flex flex-col gap-1" data-listen-target-selector>
  <p class="text-sm font-medium text-foreground">{m.settings_listenTargets_label()}</p>
  <p class="text-xs text-subtle mb-1">{m.settings_listenTargets_description()}</p>
  <ul class="flex flex-col gap-0.5">
    {#each ipOptions as ip (ip)}
      {@const covered = ip !== ALL_INTERFACES && allInterfacesSelected}
      {@const locked = covered || ip === LOOPBACK}
      {@const checked = selection.has(ip) || locked}
      <li>
        <label
          class="flex items-center gap-2 py-1 text-sm text-foreground cursor-pointer {saving
            ? 'opacity-50'
            : ''}"
          title={covered
            ? m.settings_listenTargets_coveredByAllInterfaces_note()
            : locked
              ? m.settings_listenTargets_loopbackAlwaysBound_note()
              : undefined}
        >
          <input
            type="checkbox"
            {checked}
            disabled={saving || locked}
            onchange={() => toggleIp(ip)}
            class="accent-primary"
          />
          <span class="font-mono text-xs">
            {ip === ALL_INTERFACES
              ? m.settings_listenTargets_allInterfaces_label()
              : ip === LOOPBACK
                ? m.settings_listenTargets_loopback_label()
                : ip}
          </span>
        </label>
        {#if locked && !covered}
          <p class="text-xs text-subtle ml-6">
            {m.settings_listenTargets_loopbackAlwaysBound_note()}
          </p>
        {/if}
      </li>
    {/each}
  </ul>
  {#if allInterfacesSelected}
    <p class="text-xs text-subtle">{m.settings_listenTargets_coveredByAllInterfaces_note()}</p>
  {/if}
  {#if tunnelSelected && selectedIps.length === 0}
    <p class="text-xs text-subtle">{m.settings_listenTargets_tunnelOnly_note()}</p>
  {/if}
</div>
