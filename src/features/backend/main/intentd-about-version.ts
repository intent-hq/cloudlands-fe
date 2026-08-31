/**
 * Format the bundled sidecar intentd version line for the About box
 * (macOS about panel + non-macOS Help→About dialog).
 *
 * Pure display logic extracted from `src/main/index.ts` so it is testable
 * without Electron. The pin (`intentd.version`) is the primary source; the
 * daemon probe contributes the build commit (and the version itself only when
 * the pin is unreadable). Honest-degrade: on any missing input the line just
 * shows less — never a wrong pairing.
 *
 * Keep this module dependency-light and side-effect free.
 */

/** Inputs for {@link formatIntentdAboutVersion}. */
export interface IntentdAboutVersionArgs {
  /** The bundled `intentd.version` pin, or null when unreadable. */
  pinnedVersion: string | null;
  /** Version reported by the local daemon's `system.status`, if probed. */
  probedVersion?: string | null;
  /** Build commit reported by the local daemon's `system.status`, if probed. */
  buildCommit?: string | null;
}

/**
 * Build the `intentd: <version> (<commit>)` display line, or `null` when no
 * version source is available (the About box then omits the line).
 *
 * - Version shown is the pin; the probed version is a fallback only when the
 *   pin is unreadable.
 * - The commit (shortened to 7 chars) is attached only when the probe's
 *   version matches the displayed version — a commit reported by a daemon of
 *   a different (or unknown) version does not describe the bundled sidecar.
 */
export function formatIntentdAboutVersion(args: IntentdAboutVersionArgs): string | null {
  const { pinnedVersion, probedVersion, buildCommit } = args;
  const version = pinnedVersion ?? probedVersion ?? null;
  if (!version) return null;
  const commit = typeof buildCommit === 'string' ? buildCommit.trim() : '';
  const attributable = commit.length > 0 && probedVersion === version;
  // i18n-ignore (brand name + version numbers, no translatable words)
  return attributable ? `intentd: ${version} (${commit.slice(0, 7)})` : `intentd: ${version}`;
}
