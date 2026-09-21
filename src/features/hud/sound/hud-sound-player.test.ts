import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HudTakeoverQueueState } from '../takeover/hud-takeover-queue';
import { HUD_SOUND_CUE_VOLUMES } from './hud-sound-cues';
import {
  playHudSoundCue,
  playTakeoverTransitionCues,
  resetHudSoundServiceForTests,
} from './hud-sound-player';
import { HUD_SOUND_DEFAULT_VOLUME, setHudSoundEnabled, setHudSoundVolume } from './hud-sound-state';

class MockAudio {
  src: string;
  volume = 1;
  currentTime = 0;
  preload = '';
  play = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  constructor(src: string) {
    this.src = src;
  }
}

let audioInstances: MockAudio[];

const loaders = {
  '../../../assets/sounds/hud/task-complete.mp3': () => Promise.resolve('blob:task-complete'),
  '../../../assets/sounds/hud/takeover-open.mp3': () => Promise.resolve('blob:takeover-open'),
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function state(
  phase: HudTakeoverQueueState['phase'],
  active: HudTakeoverQueueState['active'],
): HudTakeoverQueueState {
  return { phase, active, pending: [], phaseEndsAtMs: null };
}

describe('hud-sound-player', () => {
  beforeEach(() => {
    audioInstances = [];
    vi.stubGlobal(
      'Audio',
      // A `function` (not arrow) implementation so `new Audio(url)` works.
      vi.fn(function (this: unknown, src: string) {
        const audio = new MockAudio(src);
        audioInstances.push(audio);
        return audio;
      }),
    );
    resetHudSoundServiceForTests();
    setHudSoundEnabled(false);
    setHudSoundVolume(HUD_SOUND_DEFAULT_VOLUME);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('plays nothing while disabled (the default)', async () => {
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances).toHaveLength(0);
  });

  it('plays the cue at masterVolume * cueVolume when enabled (default master 0.3)', async () => {
    setHudSoundEnabled(true);
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].src).toBe('blob:task-complete');
    expect(audioInstances[0].volume).toBe(
      HUD_SOUND_DEFAULT_VOLUME * HUD_SOUND_CUE_VOLUMES['task-complete'],
    );
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);
  });

  it('scales the per-cue hierarchy by the master volume on every play', async () => {
    setHudSoundEnabled(true);
    setHudSoundVolume(0.5);
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances[0].volume).toBe(0.5 * HUD_SOUND_CUE_VOLUMES['task-complete']);

    // Live change between plays applies to the cached element too.
    setHudSoundVolume(1);
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances[0].volume).toBe(HUD_SOUND_CUE_VOLUMES['task-complete']);

    // Master 0 silences every cue without touching the enable flag.
    setHudSoundVolume(0);
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances[0].volume).toBe(0);
  });

  it('applies the master volume to the toggle-ON confirmation cue (status-update)', async () => {
    setHudSoundEnabled(true);
    setHudSoundVolume(0.5);
    const statusLoaders = {
      '../../../assets/sounds/hud/status-update.mp3': () => Promise.resolve('blob:status-update'),
    };
    await playHudSoundCue('status-update', statusLoaders);
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].volume).toBe(0.5 * HUD_SOUND_CUE_VOLUMES['status-update']);
  });

  it('silently no-ops when the asset is missing (dev tolerance)', async () => {
    setHudSoundEnabled(true);
    await expect(playHudSoundCue('pr-merged', loaders)).resolves.toBeUndefined();
    expect(audioInstances).toHaveLength(0);
  });

  it('reuses the cached element and rewinds on repeat plays', async () => {
    setHudSoundEnabled(true);
    await playHudSoundCue('task-complete', loaders);
    audioInstances[0].currentTime = 3;
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].currentTime).toBe(0);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(2);
  });

  it('swallows autoplay-policy rejections', async () => {
    setHudSoundEnabled(true);
    await playHudSoundCue('task-complete', loaders);
    audioInstances[0].play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'));
    await expect(playHudSoundCue('task-complete', loaders)).resolves.toBeUndefined();
  });

  it('shares one Audio element across rapid concurrent plays of an un-cached cue', async () => {
    setHudSoundEnabled(true);
    await Promise.all([
      playHudSoundCue('task-complete', loaders),
      playHudSoundCue('task-complete', loaders),
    ]);
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].play).toHaveBeenCalledTimes(2);
  });

  it('evicts a failing cue from the cache so the next play retries', async () => {
    setHudSoundEnabled(true);
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances).toHaveLength(1);
    audioInstances[0].play.mockRejectedValue(new DOMException('decode', 'NotSupportedError'));
    await playHudSoundCue('task-complete', loaders);
    // Evicted: a fresh element is constructed and plays fine.
    await playHudSoundCue('task-complete', loaders);
    expect(audioInstances).toHaveLength(2);
    expect(audioInstances[1].play).toHaveBeenCalledTimes(1);
  });

  it('does not play when sound is disabled while the asset loads', async () => {
    setHudSoundEnabled(true);
    let resolveUrl!: (url: string) => void;
    const slowLoaders = {
      '../../../assets/sounds/hud/task-complete.mp3': () =>
        new Promise<string>((resolve) => {
          resolveUrl = resolve;
        }),
    };
    const playPromise = playHudSoundCue('task-complete', slowLoaders);
    setHudSoundEnabled(false);
    resolveUrl('blob:task-complete');
    await playPromise;
    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].play).not.toHaveBeenCalled();
  });

  it('playTakeoverTransitionCues plays every mapped cue for the transition', async () => {
    setHudSoundEnabled(true);
    const active = {
      workspaceId: 'ws-1',
      triggers: [
        {
          workspaceId: 'ws-1',
          kind: 'task_complete' as const,
          detail: 'Done',
          raisedAtMs: 0,
          changedTaskId: null,
        },
      ],
      isViewer: false,
    };
    playTakeoverTransitionCues(state('idle', null), state('opening', active), loaders);
    await flush();
    expect(audioInstances.map((audio) => audio.src).sort()).toEqual([
      'blob:takeover-open',
      'blob:task-complete',
    ]);
  });

  it('playTakeoverTransitionCues stays silent while disabled', async () => {
    playTakeoverTransitionCues(
      state('idle', null),
      state('opening', {
        workspaceId: 'ws-1',
        triggers: [
          {
            workspaceId: 'ws-1',
            kind: 'task_complete' as const,
            detail: 'Done',
            raisedAtMs: 0,
            changedTaskId: null,
          },
        ],
        isViewer: false,
      }),
      loaders,
    );
    await flush();
    expect(audioInstances).toHaveLength(0);
  });
});
