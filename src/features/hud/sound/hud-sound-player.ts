/**
 * HUD sound player — best-effort playback of HUD sound cues, gated by the
 * localStorage enable state (default OFF). Follows the autoplay-safe pattern
 * of `src/lib/utils/notification-sound.ts`: play attempts silently fail under
 * browser autoplay policy. The speaker-toggle click unlocks audio by playing
 * a quiet confirmation cue inside the click gesture (see HudHeader.svelte).
 * Assets resolve through a lazy Vite URL glob so a missing file (e.g. assets
 * still being generated in dev) is a silent no-op, never an import error.
 * The module-level cache (max one element per cue) deliberately outlives the
 * overlay — there is no dispose path, matching the notification-sound.ts
 * singleton pattern.
 */
import type { HudTakeoverQueueState } from '../takeover/hud-takeover-queue';
import {
  cuesForTakeoverTransition,
  hudSoundCueFile,
  HUD_SOUND_CUE_VOLUMES,
  type HudSoundCue,
} from './hud-sound-cues';
import { getHudSoundVolume, isHudSoundEnabled } from './hud-sound-state';

type CueUrlLoaders = Readonly<Record<string, () => Promise<string>>>;

/** Glob keys are relative to THIS module (`src/features/hud/sound/`). */
const HUD_SOUND_ASSET_DIR = '../../../assets/sounds/hud';

const cueUrlLoaders = import.meta.glob('../../../assets/sounds/hud/*.mp3', {
  query: '?url',
  import: 'default',
}) as CueUrlLoaders;

// Promises (not elements) are cached, and set synchronously before any await,
// so two rapid plays of the same un-cached cue share one Audio element instead
// of racing to construct two.
const audioCache = new Map<HudSoundCue, Promise<HTMLAudioElement>>();

/**
 * Play one cue at its effective volume — the persisted master volume times
 * the cue's pack volume (the per-cue loudness hierarchy stays intact). No-ops
 * when HUD sound is disabled or the asset is absent from the glob; playback
 * failures (autoplay policy, decode) never propagate, but evict the cue from
 * the cache so the next play retries the load. `loaders` is a test seam
 * defaulting to the real glob.
 */
export async function playHudSoundCue(
  cue: HudSoundCue,
  loaders: CueUrlLoaders = cueUrlLoaders,
): Promise<void> {
  if (!isHudSoundEnabled()) return;
  try {
    let audioPromise = audioCache.get(cue);
    if (!audioPromise) {
      const loader = loaders[`${HUD_SOUND_ASSET_DIR}/${hudSoundCueFile(cue)}`];
      if (!loader) return;
      audioPromise = loader().then((url) => {
        const audio = new Audio(url);
        audio.preload = 'auto';
        return audio;
      });
      audioCache.set(cue, audioPromise);
    }
    const audio = await audioPromise;
    // Re-check: the user may have disabled sound while the asset loaded.
    if (!isHudSoundEnabled()) return;
    // Both factors live in [0,1], so the product needs no extra clamping.
    audio.volume = getHudSoundVolume() * HUD_SOUND_CUE_VOLUMES[cue];
    audio.currentTime = 0;
    await audio.play();
  } catch {
    // Best-effort sound: autoplay restrictions and decode failures are
    // expected (notification-sound.ts convention) — never disrupt the HUD.
    // Evict so a corrupt/rejected element doesn't fail silently forever.
    audioCache.delete(cue);
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
