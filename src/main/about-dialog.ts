/**
 * About box copy shared by the Help → About dialog (all platforms) and the
 * macOS native about panel (`app.setAboutPanelOptions`).
 *
 * Third-party license credits live here so every About surface shows the
 * same attribution: tailcat ships bundled (resources/tailcat, BSD-3-Clause);
 * its license text is packaged next to the binary as tailcat.LICENSE.
 *
 * Kept as a pure, dependency-light helper (no electron runtime import, no
 * logger) so the copy is unit-testable — `src/main/index.ts` has heavy
 * top-level side effects.
 */

import type { MessageBoxOptions } from 'electron';

import { m } from '../shared/paraglide/messages.js';

/** The About box inputs owned by `src/main/index.ts`. */
export interface AboutPanelInfo {
  applicationName: string;
  applicationVersion: string;
  copyright: string;
  /** `intentd: <version> (<commit>)` line, or '' when no version source is available. */
  intentdVersion: string;
}

/** Third-party credits block, one credit per line. */
export function formatThirdPartyCredits(): string {
  return m.dialog_about_credits_tailcat();
}

/** Build the Help → About message box options. */
export function buildAboutDialogOptions(info: AboutPanelInfo): MessageBoxOptions {
  const message = [
    info.applicationName,
    m.dialog_about_version({ version: info.applicationVersion }),
    info.intentdVersion,
    info.copyright,
  ]
    .filter(Boolean)
    .join('\n');
  return {
    type: 'info',
    title: m.menu_about_app({ appName: info.applicationName }),
    message,
    detail: formatThirdPartyCredits(),
  };
}
