/**
 * Intent OS: the Linux image that boots straight into Intent
 * (intent-hq/intent-os). Its launcher sets `INTENT_OS=1`; that one switch
 * turns on every Intent OS behavior and changes some preference defaults (a
 * value the user saved still wins).
 *
 * Main is the source of truth. App renderers learn it from the
 * `--intent-os` argument main passes in `additionalArguments`
 * (`window.electronAPI.intentOs`).
 *
 * The older single-purpose switches still work alone, so tests and other
 * hosts can turn on one behavior without the rest.
 *
 * This file has no imports so main, preload and tests can load it.
 */

/** Renderer argument main adds under Intent OS. */
const INTENT_OS_RENDERER_ARG = '--intent-os';

/** Renderer argument main adds when file choosers use the in-app picker. */
const IN_APP_PICKER_RENDERER_ARG = '--intent-in-app-picker';

type Env = Readonly<Record<string, string | undefined>>;

/** Whether this app runs on Intent OS (`INTENT_OS=1`). */
export function isIntentOs(env: Env = process.env): boolean {
  return env.INTENT_OS === '1';
}

/** Single-purpose switches that `INTENT_OS=1` implies. */
export type IntentOsImpliedSwitch =
  'INTENT_NO_SYSTEM_BROWSER' | 'INTENT_IN_APP_PICKER' | 'INTENT_BROWSER_PASSKEYS';

/** Whether `name` is on: set to `1` itself, or implied by `INTENT_OS=1`. */
export function intentOsSwitchOn(name: IntentOsImpliedSwitch, env: Env = process.env): boolean {
  return env[name] === '1' || isIntentOs(env);
}

/**
 * Switches app renderers read from `process.argv` in their preload: Intent
 * OS, and the in-app picker (implied by Intent OS).
 */
export function intentOsRendererArguments(env: Env = process.env): string[] {
  return [
    ...(isIntentOs(env) ? [INTENT_OS_RENDERER_ARG] : []),
    ...(intentOsSwitchOn('INTENT_IN_APP_PICKER', env) ? [IN_APP_PICKER_RENDERER_ARG] : []),
  ];
}
