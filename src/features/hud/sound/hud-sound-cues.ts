/**
 * HUD sound cue map — pure, dependency-light mapping from takeover triggers
 * and queue phase transitions to sound cues (the sound-pack note's prompt
 * rows). Cue ids double as the kebab-case asset file basenames under
 * `src/assets/sounds/hud/` (`<cue>.mp3`). No audio here: playback lives in
 * `hud-sound-player.ts`; this module stays unit-testable without Audio.
 */
import type {
  HudTakeoverKind,
  HudTakeoverQueueState,
  HudTakeoverTrigger,
} from '../takeover/hud-takeover-queue';

/** Every cue in the pack; ids are the asset file basenames. */
export const HUD_SOUND_CUES = [
  'takeover-open',
  'takeover-close',
  'blink-tick',
  'banner-typewriter',
  'agent-delegated',
  'agent-started',
  'agent-failed',
  'question-asked',
  'blocker-raised',
  'discussion-requested',
  'task-complete',
  'workspace-complete',
  'pr-open',
  'pr-ready',
  'pr-merged',
  'workspace-idle',
  'status-update',
] as const;

export type HudSoundCue = (typeof HUD_SOUND_CUES)[number];

/** Asset file name for a cue (kebab-case basename, mp3). */
export function hudSoundCueFile(cue: HudSoundCue): string {
  return `${cue}.mp3`;
}

/**
 * Loudness hierarchy (sound-pack note design rules): micro-ticks quietest,
 * open/close transients low, routine cues mid, attention cues most present.
 */
export const HUD_SOUND_CUE_VOLUMES: Readonly<Record<HudSoundCue, number>> = {
  'takeover-open': 0.4,
  'takeover-close': 0.4,
  'blink-tick': 0.25,
  'banner-typewriter': 0.25,
  'agent-delegated': 0.5,
  'agent-started': 0.5,
  'agent-failed': 0.7,
  'question-asked': 0.6,
  'blocker-raised': 1.0,
  'discussion-requested': 0.6,
  'task-complete': 0.5,
  'workspace-complete': 0.55,
  'pr-open': 0.5,
  'pr-ready': 0.5,
  'pr-merged': 0.55,
  'workspace-idle': 0.4,
  'status-update': 0.25,
};

/**
 * Takeover kind → cue. `manual` (card-click viewer) is deliberately ABSENT:
 * viewers play structural transients only, no kind cue. `question_asked` is
 * the generic-attention fallback — signal-carrying triggers resolve through
 * `HUD_ATTENTION_SIGNAL_CUES` instead (see `cueForTakeoverTrigger`).
 */
export const HUD_TAKEOVER_KIND_CUES: Readonly<
  Record<Exclude<HudTakeoverKind, 'manual'>, HudSoundCue>
> = {
  task_complete: 'task-complete',
  agent_delegated: 'agent-delegated',
  agent_started: 'agent-started',
  agent_failed: 'agent-failed',
  question_asked: 'question-asked',
  status_update: 'status-update',
  workspace_idle: 'workspace-idle',
  pr_open: 'pr-open',
  pr_ready: 'pr-ready',
  pr_queued: 'pr-ready',
  pr_merged: 'pr-merged',
  workspace_complete: 'workspace-complete',
};

/** Attention signal variants for `question_asked` takeovers. */
export const HUD_ATTENTION_SIGNAL_CUES: Readonly<
  Record<NonNullable<HudTakeoverTrigger['signal']>, HudSoundCue>
> = {
  question: 'question-asked',
  blocker: 'blocker-raised',
  discussion: 'discussion-requested',
};

/**
 * Cue for one trigger, or null for silent kinds (`manual`). Signal-carrying
 * `question_asked` triggers pick their variant (question/blocker/discussion).
 */
export function cueForTakeoverTrigger(
  trigger: Pick<HudTakeoverTrigger, 'kind' | 'signal'>,
): HudSoundCue | null {
  if (trigger.kind === 'manual') return null;
  if (trigger.kind === 'question_asked' && trigger.signal) {
    return HUD_ATTENTION_SIGNAL_CUES[trigger.signal];
  }
  return HUD_TAKEOVER_KIND_CUES[trigger.kind];
}

/**
 * Cues for one queue-state transition (prev → next), oldest-first:
 *  - entering 'blinking' → the blink-tick garnish (the card pre-roll
 *    flashes; reduced motion skips the phase, so no tick);
 *  - entering 'opening' → the open transient plus the newest trigger's kind
 *    cue (the banner the overlay leads with);
 *  - entering 'closing' → the close transient;
 *  - VIEWER entries (manual card-click) play the structural transients but
 *    no kind cue — the `isViewer` flag silences the kind cue structurally,
 *    not the trigger kind, so a blinking event entry converted to a viewer
 *    (`requestImmediateTakeover`) stays kind-silent despite its retained
 *    event triggers;
 *  - same-phase re-applies (e.g. a coalescing enqueue) never re-fire.
 * The banner-typewriter garnish is NOT a phase-transition cue: the wipe-in
 * starts mid-'opening' after the CSS `--banner-in-delay`, so the overlay
 * arms a matching timer instead (see HudTakeoverOverlay.svelte).
 */
export function cuesForTakeoverTransition(
  prev: HudTakeoverQueueState,
  next: HudTakeoverQueueState,
): HudSoundCue[] {
  if (prev.phase === next.phase) return [];
  const entry = next.active;
  if (!entry) return [];
  if (next.phase === 'blinking') return ['blink-tick'];
  if (next.phase === 'opening') {
    if (entry.isViewer) return ['takeover-open'];
    const newest = entry.triggers[entry.triggers.length - 1];
    const kindCue = newest ? cueForTakeoverTrigger(newest) : null;
    return kindCue ? ['takeover-open', kindCue] : ['takeover-open'];
  }
  if (next.phase === 'closing') return ['takeover-close'];
  return [];
}
