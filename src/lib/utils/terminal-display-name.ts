/**
 * Display-layer localization for daemon-provided terminal names.
 *
 * `TerminalTab.name` is the spawn-time display name the daemon sends over the
 * wire (PROTOCOL §5.9 `terminal.list`): either "Setup Script" for the
 * workspace setup terminal (intentd `SETUP_TERMINAL_NAME`), or the constant
 * "Terminal" fallback the daemon sends for PTYs spawned without a name.
 * `name` is **always present** on the wire (never omitted), so both values
 * are daemon-owned English strings. The wire value must round-trip untouched
 * through the store and persistence; these helpers map known spawn-time names
 * to localized catalog labels at render time only, falling back to the raw
 * name for unknown or user-set titles.
 */
import { m } from '$shared/paraglide/messages.js';

/**
 * Known daemon spawn-time terminal names → localized labels. Keyed by the
 * exact wire value; `Object.hasOwn` lookup so prototype keys never resolve.
 */
const DAEMON_TERMINAL_NAMES: Record<string, () => string> = {
  'Setup Script': () => m.terminal_daemonName_setupScript_label(),
  Terminal: () => m.terminal_quakeOverlay_terminal_fallback(),
};

/**
 * Map a daemon-provided terminal name to its localized label, or return the
 * raw name unchanged when it is not a known spawn-time name.
 */
export function localizeDaemonTerminalName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return Object.hasOwn(DAEMON_TERMINAL_NAMES, name) ? DAEMON_TERMINAL_NAMES[name]() : name;
}

/**
 * Resolve the display name for a terminal tab: user-set `customName` wins
 * verbatim, then the (localized) daemon name, then the generic fallback.
 */
export function terminalDisplayName(term: { name?: string; customName?: string }): string {
  return (
    term.customName ||
    localizeDaemonTerminalName(term.name) ||
    m.terminal_quakeOverlay_terminal_fallback()
  );
}
