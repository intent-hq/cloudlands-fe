<script lang="ts">
  /**
   * Listen-target selector (mirrors the `intentd pair` picker): the daemon's
   * available IP addresses with the currently bound ones selected.
   * Presentational — the parent owns fetching and persistence
   * (`server.bindAddress`, `server.tunnel.enabled`, `server.tunnel.only`)
   * and hosts the tunnel on/off toggle; `tunnelSelected` mirrors it here.
   *
   * Selection semantics:
   * - IPs only            → bindAddress=[ips], tunnel.enabled=false
   * - IPs + tunnel        → bindAddress=[ips], tunnel.enabled=true, tunnel.only=false
   * - "All interfaces" (0.0.0.0) is exclusive with specific IPs (daemon
   *   validation: unspecified-only-alone). While it is selected, the other
   *   addresses render checked but locked (0.0.0.0 already covers them);
   *   unchecking it makes them individually toggleable again.
   * - tunnel only         → tunnel.enabled=true, tunnel.only=true (no direct listeners)
   * - "127.0.0.1 (localhost)" is always listed; while the tunnel is enabled
   *   alongside specific IPs it is auto-selected and locked (the tailcat
   *   sidecar forwards tunnel connections to 127.0.0.1:<port>, so loopback
   *   must stay bound). All-interfaces already covers loopback, and in
   *   tunnel-only mode the daemon binds loopback itself (mirroring the
   *   `intentd pair` picker, which leaves loopback unchecked there), so the
   *   lock applies in neither of those postures.
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
  // Loopback is always listed: the tunnel forwards to it (see below).
  const ipOptions = $derived([
    ALL_INTERFACES,
    LOOPBACK,
    ...new Set(
      [...availableIps, ...selectedIps].filter((ip) => ip !== ALL_INTERFACES && ip !== LOOPBACK),
    ),
  ]);

  const selection = $derived(new Set(selectedIps));

  // While all-interfaces is bound, every other address is already covered by
  // 0.0.0.0 — render them checked but locked (same pattern as the loopback
  // lock below) until all-interfaces is unchecked.
  const allInterfacesSelected = $derived(selection.has(ALL_INTERFACES));

  // The tailcat sidecar forwards tunnel connections to 127.0.0.1:<port>, so
  // loopback must stay bound while the tunnel is selected alongside specific
  // IPs — otherwise the tunnel connects but every forwarded connection is
  // reset. All-interfaces already covers loopback, and tunnel-only (no IPs)
  // binds loopback daemon-side, so the lock applies in neither posture.
  const loopbackLocked = $derived(
    tunnelSelected && !selection.has(ALL_INTERFACES) && selectedIps.some((ip) => ip !== LOOPBACK),
  );

  /** Force loopback into an emission when the lock applies to it. */
  function withLoopbackLock(ips: string[], tunnel: boolean): string[] {
    if (tunnel && ips.length > 0 && !ips.includes(ALL_INTERFACES) && !ips.includes(LOOPBACK)) {
      return [...ips, LOOPBACK];
    }
    return ips;
  }

  // At least one target must stay selected overall. Enforced as a refusal
  // (the checkbox snaps back) rather than disabling the sole entry, so every
  // entry — including all-interfaces — stays clickable and deselectable
  // whenever another target is selected (intent-hq/monorepo bug report:
  // 0.0.0.0 rendered disabled and could not be unchecked).
  function toggleIp(ip: string, input: HTMLInputElement): void {
    let ips: string[];
    if (selection.has(ip)) {
      // Removal bases on selectedIps (not effectiveIps): deselecting the
      // last real IP falls through to tunnel-only instead of stranding a
      // lock-forced loopback; withLoopbackLock re-forces it otherwise.
      ips = selectedIps.filter((v) => v !== ip);
    } else if (ip === ALL_INTERFACES) {
      // Unspecified bind must stand alone.
      ips = [ALL_INTERFACES];
    } else {
      ips = [...selectedIps.filter((v) => v !== ALL_INTERFACES), ip];
    }
    ips = withLoopbackLock(ips, tunnelSelected);
    if (ips.length === 0 && !tunnelSelected) {
      if (ip === ALL_INTERFACES) {
        // The covered addresses are locked while 0.0.0.0 is bound, so
        // unchecking it is the only way out — fall back to loopback instead
        // of refusing, then the unlocked entries are toggleable again.
        onchange({ ips: [LOOPBACK], tunnel: tunnelSelected });
        return;
      }
      input.checked = true; // refuse: never allow zero targets
      return;
    }
    onchange({ ips, tunnel: tunnelSelected });
  }
</script>

<div class="flex flex-col gap-1" data-listen-target-selector>
  <p class="text-sm font-medium text-foreground">{m.settings_listenTargets_label()}</p>
  <p class="text-xs text-subtle mb-1">{m.settings_listenTargets_description()}</p>
  <ul class="flex flex-col gap-0.5">
    {#each ipOptions as ip (ip)}
      {@const covered = ip !== ALL_INTERFACES && allInterfacesSelected}
      {@const locked = covered || (ip === LOOPBACK && loopbackLocked)}
      {@const checked = selection.has(ip) || locked}
      <li>
        <label
          class="flex items-center gap-2 py-1 text-sm text-foreground cursor-pointer {saving
            ? 'opacity-50'
            : ''}"
          title={covered
            ? m.settings_listenTargets_coveredByAllInterfaces_note()
            : locked
              ? m.settings_listenTargets_loopbackRequired_note()
              : undefined}
        >
          <input
            type="checkbox"
            {checked}
            disabled={saving || locked}
            onchange={(e) => toggleIp(ip, e.currentTarget)}
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
          <p class="text-xs text-subtle ml-6">{m.settings_listenTargets_loopbackRequired_note()}</p>
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
