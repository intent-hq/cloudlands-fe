import { describe, expect, it } from 'vitest';
import {
  HUD_TAKEOVER_KINDS,
  type HudTakeoverEntry,
  type HudTakeoverPhase,
  type HudTakeoverQueueState,
  type HudTakeoverTrigger,
} from '../takeover/hud-takeover-queue';
import {
  cueForTakeoverTrigger,
  cuesForTakeoverTransition,
  HUD_ATTENTION_SIGNAL_CUES,
  HUD_SOUND_CUE_VOLUMES,
  HUD_SOUND_CUES,
  HUD_TAKEOVER_KIND_CUES,
  hudSoundCueFile,
} from './hud-sound-cues';

function trigger(overrides: Partial<HudTakeoverTrigger> = {}): HudTakeoverTrigger {
  return {
    workspaceId: 'ws-1',
    kind: 'task_complete',
    detail: 'Ship it',
    raisedAtMs: 0,
    changedTaskId: null,
    ...overrides,
  };
}

function entry(overrides: Partial<HudTakeoverEntry> = {}): HudTakeoverEntry {
  return { workspaceId: 'ws-1', triggers: [trigger()], isViewer: false, ...overrides };
}

function state(phase: HudTakeoverPhase, active: HudTakeoverEntry | null): HudTakeoverQueueState {
  return { phase, active, pending: [], phaseEndsAtMs: null };
}

describe('cue map', () => {
  it('maps every takeover kind except manual (which is silent)', () => {
    for (const kind of HUD_TAKEOVER_KINDS) {
      const cue = cueForTakeoverTrigger(trigger({ kind }));
      if (kind === 'manual') {
        expect(cue).toBeNull();
      } else {
        expect(cue).toBe(HUD_TAKEOVER_KIND_CUES[kind]);
        expect(HUD_SOUND_CUES).toContain(cue);
      }
    }
  });

  it('resolves question_asked signal variants; generic falls back', () => {
    expect(cueForTakeoverTrigger(trigger({ kind: 'question_asked', signal: 'question' }))).toBe(
      'question-asked',
    );
    expect(cueForTakeoverTrigger(trigger({ kind: 'question_asked', signal: 'blocker' }))).toBe(
      'blocker-raised',
    );
    expect(cueForTakeoverTrigger(trigger({ kind: 'question_asked', signal: 'discussion' }))).toBe(
      'discussion-requested',
    );
    expect(cueForTakeoverTrigger(trigger({ kind: 'question_asked', signal: null }))).toBe(
      'question-asked',
    );
    for (const cue of Object.values(HUD_ATTENTION_SIGNAL_CUES)) {
      expect(HUD_SOUND_CUES).toContain(cue);
    }
  });

  it('ignores signals on non-question kinds', () => {
    expect(cueForTakeoverTrigger(trigger({ kind: 'agent_failed', signal: 'blocker' }))).toBe(
      'agent-failed',
    );
  });

  it('gives every cue a kebab-case mp3 file name and a (0,1] volume', () => {
    for (const cue of HUD_SOUND_CUES) {
      expect(hudSoundCueFile(cue)).toBe(`${cue}.mp3`);
      expect(cue).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      const volume = HUD_SOUND_CUE_VOLUMES[cue];
      expect(volume).toBeGreaterThan(0);
      expect(volume).toBeLessThanOrEqual(1);
    }
  });
});

describe('cuesForTakeoverTransition', () => {
  it('plays open transient + newest trigger cue on entering opening', () => {
    const active = entry({
      triggers: [trigger(), trigger({ kind: 'agent_failed' })],
    });
    expect(cuesForTakeoverTransition(state('blinking', active), state('opening', active))).toEqual([
      'takeover-open',
      'agent-failed',
    ]);
  });

  it('plays open cues on an instant idle → opening (reduced motion)', () => {
    expect(cuesForTakeoverTransition(state('idle', null), state('opening', entry()))).toEqual([
      'takeover-open',
      'task-complete',
    ]);
  });

  it('uses the attention signal variant for the kind cue', () => {
    const active = entry({
      triggers: [trigger({ kind: 'question_asked', signal: 'blocker' })],
    });
    expect(cuesForTakeoverTransition(state('idle', null), state('opening', active))).toEqual([
      'takeover-open',
      'blocker-raised',
    ]);
  });

  it('plays the close transient on entering closing', () => {
    const active = entry();
    expect(cuesForTakeoverTransition(state('dwelling', active), state('closing', active))).toEqual([
      'takeover-close',
    ]);
  });

  it('plays the blink tick on entering the pre-roll (fresh open and chained next entry)', () => {
    const active = entry();
    expect(cuesForTakeoverTransition(state('idle', null), state('blinking', active))).toEqual([
      'blink-tick',
    ]);
    expect(cuesForTakeoverTransition(state('closing', active), state('blinking', active))).toEqual([
      'blink-tick',
    ]);
  });

  it('plays structural transients but no kind cue for manual viewers', () => {
    const viewer = entry({ isViewer: true, triggers: [trigger({ kind: 'manual', detail: '' })] });
    expect(cuesForTakeoverTransition(state('idle', null), state('blinking', viewer))).toEqual([
      'blink-tick',
    ]);
    expect(cuesForTakeoverTransition(state('blinking', viewer), state('opening', viewer))).toEqual([
      'takeover-open',
    ]);
    expect(cuesForTakeoverTransition(state('dwelling', viewer), state('closing', viewer))).toEqual([
      'takeover-close',
    ]);
  });

  it('suppresses the kind cue for a blink-converted viewer retaining event triggers', () => {
    const viewer = entry({ isViewer: true, triggers: [trigger({ kind: 'task_complete' })] });
    expect(cuesForTakeoverTransition(state('blinking', viewer), state('opening', viewer))).toEqual([
      'takeover-open',
    ]);
  });

  it('never re-fires on same-phase re-applies (coalescing enqueue)', () => {
    const active = entry();
    const grown = entry({ triggers: [trigger(), trigger({ kind: 'agent_started' })] });
    expect(cuesForTakeoverTransition(state('blinking', active), state('blinking', grown))).toEqual(
      [],
    );
    expect(cuesForTakeoverTransition(state('opening', active), state('opening', grown))).toEqual(
      [],
    );
  });

  it('is silent on non-blink/open/close transitions', () => {
    const active = entry();
    expect(cuesForTakeoverTransition(state('opening', active), state('dwelling', active))).toEqual(
      [],
    );
    expect(cuesForTakeoverTransition(state('closing', active), state('idle', null))).toEqual([]);
  });
});
