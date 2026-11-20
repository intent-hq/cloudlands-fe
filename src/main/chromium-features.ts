/**
 * Chromium features Intent turns off because Electron ships the web API
 * without the browser UI it needs.
 *
 * FedCm: Electron exposes `IdentityCredential` and `navigator.credentials.get({ identity })`
 * but has no account chooser, so every request ends as "Prompt dismissed"
 * (NetworkError). Google Identity Services takes its FedCM path for "Sign in
 * with Google" buttons whenever the API exists (site opt-in or a Google
 * experiment), and it ignores a rejected button request: the page spins
 * forever and never calls window.open. Without the API, it uses its popup
 * flow, which the browser panel allows (webview-security.ts).
 */
const UNSUPPORTED_CHROMIUM_FEATURES: readonly string[] = ['FedCm'];

/** The part of Electron's `app.commandLine` this module needs. */
export interface ChromiumCommandLine {
  getSwitchValue(name: string): string;
  appendSwitch(name: string, value?: string): void;
}

/**
 * Add `features` to `--disable-features`, keeping any value already there
 * (Chromium reads only the last copy of a switch). Call before `app` is ready.
 */
export function disableChromiumFeatures(
  commandLine: ChromiumCommandLine,
  features: readonly string[] = UNSUPPORTED_CHROMIUM_FEATURES,
): void {
  const current = commandLine
    .getSwitchValue('disable-features')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const missing = features.filter((name) => !current.includes(name));
  if (missing.length === 0) return;
  commandLine.appendSwitch('disable-features', [...current, ...missing].join(','));
}
