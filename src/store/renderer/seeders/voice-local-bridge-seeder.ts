/**
 * Voice local-transcription invoke bridge — forwards `voice:local-available`
 * and `voice:transcribe-local` to the real Electron preload bridge
 * (`window.electronAPI.invoke`) on the electron platform only (same pattern
 * as native-dialog-bridge-seeder).
 *
 * On web (browser mock sentinel or no bridge) the availability probe folds
 * to `{ success: true, available: false }` — the OS engine is an
 * Electron-main capability, so absence IS the honest answer — while the
 * transcribe channel rejects loudly: reaching it without the bridge is a
 * gating bug, never a silent empty transcript. The authorization channel
 * folds to a typed failure so the settings flow surfaces a clean error.
 */
import { registerMockIpcHandler } from '$shared/ipc-mock-router';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { detectPlatform } from '$lib/utils/platform-capabilities';

function realBridge(): ((channel: string, payload?: unknown) => Promise<unknown>) | null {
  const win = typeof window !== 'undefined' ? window : undefined;
  const bridge = win?.electronAPI;
  if (win && detectPlatform(win) === 'electron' && bridge && typeof bridge.invoke === 'function') {
    return (channel, payload) => bridge.invoke(channel, payload);
  }
  return null;
}

/** Register the voice local-transcription bridge handlers. Idempotent. */
export function registerVoiceLocalBridge(): void {
  registerMockIpcHandler(IPC_CHANNELS.VOICE.LOCAL_AVAILABLE, async (payload?: unknown) => {
    const forward = realBridge();
    if (forward) return forward(IPC_CHANNELS.VOICE.LOCAL_AVAILABLE, payload);
    return { success: true, available: false };
  });

  registerMockIpcHandler(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, async (payload?: unknown) => {
    const forward = realBridge();
    if (forward) return forward(IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL, payload);
    throw new Error(
      `'${IPC_CHANNELS.VOICE.TRANSCRIBE_LOCAL}' requires the native Electron bridge — ` +
        `gate the OS dictation engine on voice:local-available before invoking it.`,
    );
  });

  registerMockIpcHandler(
    IPC_CHANNELS.VOICE.REQUEST_LOCAL_AUTHORIZATION,
    async (payload?: unknown) => {
      const forward = realBridge();
      if (forward) return forward(IPC_CHANNELS.VOICE.REQUEST_LOCAL_AUTHORIZATION, payload);
      return {
        success: false,
        error: {
          code: 'unsupported-platform',
          // i18n-ignore (wire error detail, not UI copy)
          message: 'OS dictation requires the native Electron bridge',
        },
      };
    },
  );
}

registerVoiceLocalBridge();
