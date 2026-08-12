/**
 * HUD sound service — best-effort playback of HUD sound cues, gated by the
 * localStorage enable state (default OFF). Follows the autoplay-safe pattern
 * of `src/lib/utils/notification-sound.ts`: play attempts silently fail under
 * browser autoplay policy (the speaker-toggle click is the unlocking user
 * gesture). Assets resolve through a lazy Vite URL glob so a missing file
 * (e.g. assets still being generated in dev) is a silent no-op, never an
 * import error.
 */
import type { HudTakeoverQueueState } from '../takeover/hud-takeover-queue';
import {
  cuesForTakeoverTransition,
  hudSoundCueFile,
  HUD_SOUND_CUE_VOLUMES,
  type HudSoundCue,
} from './hud-sound-cues';
import { isHudSoundEnabled } from './hud-sound-state';

type CueUrlLoaders = Readonly<Record<string, () => Promise<string>>>;

/** Glob keys are relative to THIS module (`src/features/hud/sound/`). */
const HUD_SOUND_ASSET_DIR = '../../../assets/sounds/hud';

const cueUrlLoaders = import.meta.glob('../../../assets/sounds/hud/*.mp3', {
  query: '?url',
  import: 'default',
}) as CueUrlLoaders;

const audioCache = new Map<HudSoundCue, HTMLAudioElement>();

/**
 * Play one cue at its pack volume. No-ops when HUD sound is disabled or the
 * asset is absent from the glob; playback failures (autoplay policy, decode)
 * never propagate. `loaders` is a test seam defaulting to the real glob.
 */
export async function playHudSoundCue(
  cue: HudSoundCue,
  loaders: CueUrlLoaders = cueUrlLoaders,
): Promise<void> {
  if (!isHudSoundEnabled()) return;
  try {
    let audio = audioCache.get(cue);
    if (!audio) {
      const loader = loaders[`${HUD_SOUND_ASSET_DIR}/${hudSoundCueFile(cue)}`];
      if (!loader) return;
      const url = await loader();
      audio = new Audio(url);
      audio.preload = 'auto';
      audioCache.set(cue, audio);
    }
    audio.volume = HUD_SOUND_CUE_VOLUMES[cue];
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // Best-effort sound: autoplay restrictions and decode failures are
    // expected (notification-sound.ts convention) — never disrupt the HUD.
  }
}

/**
 * Play every cue a takeover queue transition maps to (see
 * `cuesForTakeoverTransition`). Fire-and-forget; the enable gate lives in
 * `playHudSoundCue`.
 */
export function playTakeoverTransitionCues(
  prev: HudTakeoverQueueState,
  next: HudTakeoverQueueState,
  loaders?: CueUrlLoaders,
): void {
  for (const cue of cuesForTakeoverTransition(prev, next)) {
    void playHudSoundCue(cue, loaders);
  }
}

/** Drop cached audio elements (tests). */
export function resetHudSoundServiceForTests(): void {
  audioCache.clear();
}
