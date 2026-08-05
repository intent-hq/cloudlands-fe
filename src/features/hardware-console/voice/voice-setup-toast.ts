/**
 * Actionable "voice transcription is not configured" toast, shown when a
 * dictation trigger is gated because the effective engine is `unavailable`
 * (daemon selected, provider key missing, no OS engine — see
 * $features/voice/effective-voice-engine). The Open Settings action jumps
 * to Settings → Accounts scrolled to the Voice dictation section, where
 * the key can be added or the engine switched.
 *
 * Dependency-light per AGENTS.md middleware conventions (reachable from
 * the action-key registry): no selector imports; the toast lib is imported
 * lazily and navigation goes through the main-safe navigation.client seam
 * (same pattern as connection-toast-service).
 */

import { createLogger } from '$lib/utils/client-logger';
import { navigateToRoute } from '$lib/utils/navigation.client';
import { m } from '$shared/paraglide/messages.js';

const logger = createLogger('HardwareConsoleVoiceSetupToast');

/** Shared id: repeated gated presses refresh one toast instead of stacking. */
const VOICE_SETUP_TOAST_ID = 'hardware-console-voice-setup';

/** Lazily pull the toast lib so this middleware-reachable module stays light. */
let toastPromise: Promise<(typeof import('svelte-sonner'))['toast']> | null = null;
function getToast() {
  if (!toastPromise) toastPromise = import('svelte-sonner').then((module) => module.toast);
  return toastPromise;
}

/** Mirrors SETTINGS_PREV_PATH_KEY in $lib/utils/workspace-navigation — that
 *  module is renderer-only ($app/* imports) and this middleware-reachable
 *  file is part of the main-process type-check, so it cannot be imported
 *  here (even dynamically). */
const SETTINGS_PREV_PATH_KEY = 'settings-previous-path';

/** Open Settings → Accounts scrolled to the Voice dictation section. */
function openVoiceSettings(): void {
  if (typeof sessionStorage !== 'undefined' && typeof window !== 'undefined') {
    sessionStorage.setItem(SETTINGS_PREV_PATH_KEY, window.location.pathname);
  }
  navigateToRoute('/settings?tab=accounts#voice').catch((error: unknown) => {
    logger.error('Failed to open voice settings from setup toast', error);
  });
}

/**
 * The "Open Settings" toast action (label + deep link to the Voice
 * dictation section) — shared with the transcription-failure toasts so OS
 * dictation failures (authorization denied, helper error) stay actionable.
 * Built at call time so the label reflects the active locale.
 */
export function voiceSettingsToastAction(): { label: string; onClick: () => void } {
  return {
    label: m.hardwareConsole_voice_openSettings_label(),
    onClick: () => openVoiceSettings(),
  };
}

/**
 * Show the actionable no-key error toast (fire-and-forget: callers gate the
 * gesture synchronously; the toast lib import settles on its own).
 */
export function showVoiceSetupToast(): void {
  void getToast().then((toast) => {
    toast.error(m.hardwareConsole_voice_noKey_error(), {
      id: VOICE_SETUP_TOAST_ID,
      action: voiceSettingsToastAction(),
    });
  });
}
