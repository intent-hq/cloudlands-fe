import agentCompleteSound from '../../assets/sounds/agent-complete.mp3?url';
import { readLocalNotificationSound } from './local-notification-audio';

let soundPath = '';
let pathVersion = 0;
let playbackVersion = 0;
let bundledAudio: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;
let loading: Promise<AudioBuffer | null> | null = null;

function releaseNodes() {
  if (source) {
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* A failed start has no active source to stop. */
    }
    source.disconnect();
    source = null;
  }
  gain?.disconnect();
  gain = null;
}

function stopPlayback() {
  playbackVersion += 1;
  bundledAudio?.pause();
  releaseNodes();
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Called by preference sagas, including external settings changes and resets. */
export function setNotificationSoundPath(path: string): void {
  if (soundPath === path) return;
  stopPlayback();
  soundPath = path;
  pathVersion += 1;
  loading = null;
}

async function loadCustomSound(): Promise<AudioBuffer | null> {
  // Share only in-flight work: a saved path can be removed or replaced between plays.
  if (loading) return loading;
  const version = pathVersion;
  const path = soundPath;
  const pending = (async () => {
    let active = true;
    try {
      // Bound both a disconnected local mount and a stalled decoder.
      const decoded = await withTimeout(
        (async () => {
          const bytes = await readLocalNotificationSound(path);
          if (!active || !bytes || version !== pathVersion) return null;
          context ??= new AudioContext();
          return await context.decodeAudioData(bytes);
        })(),
        5000,
      );
      if (version !== pathVersion) return null;
      return decoded;
    } catch {
      return null;
    } finally {
      active = false;
    }
  })();
  loading = pending;
  try {
    return await pending;
  } finally {
    if (loading === pending) loading = null;
  }
}

/** Best-effort playback; preview deliberately bypasses mute/focus, as before. */
export async function playNotificationSound(
  volume = 0.5,
  path = '',
  canPlay: () => boolean = () => true,
): Promise<void> {
  setNotificationSoundPath(path);
  stopPlayback();
  const version = playbackVersion;
  const current = () => version === playbackVersion && canPlay();
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.5;
  try {
    if (path) {
      const buffer = await loadCustomSound();
      if (!current()) return;
      if (buffer && context) {
        try {
          // resume() may remain pending under autoplay/device restrictions.
          const resumed = await withTimeout(
            context.resume().then(() => true),
            1000,
          );
          if (!resumed) throw new Error('Audio device unavailable');
          if (!current()) return;
          source = context.createBufferSource();
          gain = context.createGain();
          source.buffer = buffer;
          gain.gain.value = level;
          source.connect(gain);
          gain.connect(context.destination);
          source.onended = () => {
            if (version === playbackVersion) stopPlayback();
          };
          source.start();
          return;
        } catch {
          // A decoder/device failure must not prevent the bundled fallback.
          if (!current()) return;
          releaseNodes();
        }
      }
    }
    if (!current()) return;
    bundledAudio ??= new Audio(agentCompleteSound);
    bundledAudio.volume = level;
    bundledAudio.currentTime = 0;
    await bundledAudio.play();
  } catch {
    // Autoplay policies and unavailable audio devices never disrupt delivery.
  }
}
