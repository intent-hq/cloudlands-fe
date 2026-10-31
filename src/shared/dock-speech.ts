/**
 * Streaming dock dictation: wire types for the native `intent-dock-speech`
 * helper and the pure transcript model that turns its events into editor
 * insertions with click marks at the point of speech.
 *
 * Elapsed values are milliseconds on the helper's audio clock (frames since
 * the first microphone buffer), so marks and word timings share one timeline.
 */
import type { DockInsertionPart } from './dock-evidence';

export const DOCK_SPEECH_SILENCE_MS = 8_000;

export type DockSpeechEngine = 'analyzer' | 'recognizer';
export type DockSpeechAuthorization = 'authorized' | 'denied' | 'restricted' | 'notDetermined';

export type DockSpeechErrorCode =
  | 'unsupported-platform'
  | 'helper-missing'
  | 'speech-permission-denied'
  | 'speech-permission-restricted'
  | 'microphone-permission-denied'
  | 'microphone-permission-restricted'
  | 'recognizer-unavailable'
  | 'locale-unsupported'
  | 'assets-unavailable'
  | 'no-input-device'
  | 'audio-engine-failed'
  | 'recognition-failed'
  | 'helper-exited'
  | 'bad-command';

export interface DockSpeechCapability {
  available: boolean;
  engine: DockSpeechEngine | null;
  speech: DockSpeechAuthorization | null;
  microphone: DockSpeechAuthorization | null;
  locale: string | null;
  onDevice: boolean;
  /** Why `available` is false; permission states that a start would prompt for are still available. */
  reason?: DockSpeechErrorCode;
}

export interface DockSpeechSegment {
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export type DockSpeechEndReason = 'stopped' | 'cancelled' | 'silence' | 'max-duration' | 'error';

export type DockSpeechEvent =
  | {
      type: 'ready';
      sessionId: string;
      engine: DockSpeechEngine;
      locale: string;
      onDevice: boolean;
      startedAtEpochMs: number;
    }
  | { type: 'state'; state: 'preparing' | 'listening' | 'finalizing' }
  | { type: 'level'; elapsedMs: number; level: number }
  | {
      type: 'transcript';
      /** Increasing per session; a later utterance never revises an earlier one. */
      utterance: number;
      revision: number;
      isFinal: boolean;
      text: string;
      startMs: number | null;
      endMs: number | null;
      /** Concatenates back to `text`. */
      segments: DockSpeechSegment[];
    }
  | { type: 'mark'; markId: string; elapsedMs: number }
  | { type: 'error'; code: DockSpeechErrorCode; message: string; fatal: boolean }
  | { type: 'ended'; reason: DockSpeechEndReason; elapsedMs: number; micAudioPath?: string };

export type DockSpeechCommand =
  | {
      cmd: 'start';
      sessionId: string;
      locale?: string;
      contextualStrings?: string[];
      silenceMs?: number;
      maxMs?: number;
      micAudioPath?: string;
    }
  | { cmd: 'mark'; markId: string }
  /** Annotating activity: resets the silence auto-stop; no event is sent. */
  | { cmd: 'activity' }
  | { cmd: 'stop' }
  | { cmd: 'cancel' };

const ERROR_CODES = new Set<string>([
  'unsupported-platform',
  'helper-missing',
  'speech-permission-denied',
  'speech-permission-restricted',
  'microphone-permission-denied',
  'microphone-permission-restricted',
  'recognizer-unavailable',
  'locale-unsupported',
  'assets-unavailable',
  'no-input-device',
  'audio-engine-failed',
  'recognition-failed',
  'helper-exited',
  'bad-command',
]);
const END_REASONS = new Set<string>(['stopped', 'cancelled', 'silence', 'max-duration', 'error']);

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isTime = (value: unknown): value is number | null => value === null || isNumber(value);

function dockSpeechErrorCode(value: unknown): DockSpeechErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value)
    ? (value as DockSpeechErrorCode)
    : 'recognition-failed';
}

/** Validate one helper stdout line; anything malformed is dropped (null). */
export function parseDockSpeechEvent(line: string): DockSpeechEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const event = raw as Record<string, unknown>;
  switch (event.type) {
    case 'ready':
      return typeof event.sessionId === 'string' &&
        (event.engine === 'analyzer' || event.engine === 'recognizer') &&
        typeof event.locale === 'string' &&
        isNumber(event.startedAtEpochMs)
        ? {
            type: 'ready',
            sessionId: event.sessionId,
            engine: event.engine,
            locale: event.locale,
            onDevice: event.onDevice === true,
            startedAtEpochMs: event.startedAtEpochMs,
          }
        : null;
    case 'state':
      return event.state === 'preparing' ||
        event.state === 'listening' ||
        event.state === 'finalizing'
        ? { type: 'state', state: event.state }
        : null;
    case 'level':
      return isNumber(event.elapsedMs) && isNumber(event.level)
        ? {
            type: 'level',
            elapsedMs: event.elapsedMs,
            level: Math.min(1, Math.max(0, event.level)),
          }
        : null;
    case 'transcript': {
      if (
        !Number.isInteger(event.utterance) ||
        !isNumber(event.revision) ||
        typeof event.isFinal !== 'boolean' ||
        typeof event.text !== 'string' ||
        !isTime(event.startMs) ||
        !isTime(event.endMs) ||
        !Array.isArray(event.segments)
      )
        return null;
      const segments = event.segments.filter(
        (segment): segment is DockSpeechSegment =>
          !!segment &&
          typeof segment.text === 'string' &&
          isTime(segment.startMs) &&
          isTime(segment.endMs),
      );
      return {
        type: 'transcript',
        utterance: event.utterance as number,
        revision: event.revision,
        isFinal: event.isFinal,
        text: event.text,
        startMs: event.startMs,
        endMs: event.endMs,
        segments,
      };
    }
    case 'mark':
      return typeof event.markId === 'string' && event.markId && isNumber(event.elapsedMs)
        ? { type: 'mark', markId: event.markId, elapsedMs: event.elapsedMs }
        : null;
    case 'error':
      return {
        type: 'error',
        code: dockSpeechErrorCode(event.code),
        message: typeof event.message === 'string' ? event.message : '',
        fatal: event.fatal === true,
      };
    case 'ended':
      return typeof event.reason === 'string' && END_REASONS.has(event.reason)
        ? {
            type: 'ended',
            reason: event.reason as DockSpeechEndReason,
            elapsedMs: isNumber(event.elapsedMs) ? event.elapsedMs : 0,
            ...(typeof event.micAudioPath === 'string' ? { micAudioPath: event.micAudioPath } : {}),
          }
        : null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Transcript model
// ---------------------------------------------------------------------------

interface Utterance {
  id: number;
  revision: number;
  final: boolean;
  text: string;
  startMs: number | null;
  endMs: number | null;
  segments: DockSpeechSegment[];
}

interface PendingMark {
  markId: string;
  elapsedMs: number;
}

export interface DockSpeechCommit {
  /** Stable per utterance (`sessionId:utterance`) so the editor applies it once. */
  id: string;
  parts: DockInsertionPart[];
}

export interface DockSpeechTranscriptUpdate {
  /** Finalized utterances, in order; each id is emitted at most once. */
  commits: DockSpeechCommit[];
  /** Replaces the previous interim in place; render a trailing "…" while non-empty. */
  interim: DockInsertionPart[];
  /** Set once, on `ended`: leftover marks (no later speech) and the end reason. */
  ended?: { reason: DockSpeechEndReason; trailing: DockSpeechCommit | null };
}

/** Segment timings, filling untimed pieces by interpolating across the utterance. */
function timedSegments(utterance: Utterance): Array<{ text: string; startMs: number }> {
  const segments = utterance.segments.length
    ? utterance.segments
    : [{ text: utterance.text, startMs: utterance.startMs, endMs: utterance.endMs }];
  const total = segments.reduce((sum, segment) => sum + segment.text.length, 0) || 1;
  const from = utterance.startMs ?? segments.find((s) => s.startMs !== null)?.startMs ?? 0;
  const to =
    utterance.endMs ?? [...segments].reverse().find((s) => s.endMs !== null)?.endMs ?? from;
  let offset = 0;
  return segments.map((segment) => {
    const startMs = segment.startMs ?? from + ((to - from) * offset) / total;
    offset += segment.text.length;
    return { text: segment.text, startMs };
  });
}

/** Text that attaches to what precedes it (no space before): ".", ",", "?", "…" and closers. */
const ATTACHES_LEFT = /^[.,!?;:%)\]}…'’]/;

/** Adjacent text merged; single spaces at text/chip seams; ends trimmed. */
function normalizeParts(parts: DockInsertionPart[]): DockInsertionPart[] {
  const out: DockInsertionPart[] = [];
  for (const part of parts) {
    const previous = out.at(-1);
    if (part.kind === 'text') {
      const text = part.text.replace(/\s+/g, ' ');
      if (!text.trim()) {
        if (previous?.kind === 'text' && text) previous.text += ' ';
        continue;
      }
      if (previous?.kind === 'text') previous.text += text;
      else out.push({ kind: 'text', text });
    } else {
      out.push(part);
    }
  }
  return out
    .map((part, index): DockInsertionPart => {
      if (part.kind !== 'text') return part;
      let text = part.text.replace(/ {2,}/g, ' ');
      text =
        index === 0
          ? text.trimStart()
          : out[index - 1].kind === 'mark'
            ? // Punctuation after a chip attaches to it ("this [2]." not "this [2] .").
              ATTACHES_LEFT.test(text.trimStart())
              ? text.trimStart()
              : ` ${text.trimStart()}`
            : text;
      text =
        index === out.length - 1
          ? text.trimEnd()
          : out[index + 1].kind === 'mark'
            ? `${text.trimEnd()} `
            : text;
      return { kind: 'text', text };
    })
    .filter((part) => part.kind === 'mark' || part.text.length > 0);
}

/**
 * Words that start before a click go before its chip. Returns the woven parts
 * and the marks that fall after this utterance.
 */
function weave(
  utterance: Utterance,
  marks: readonly PendingMark[],
  claimAllBefore: number,
): { parts: DockInsertionPart[]; rest: PendingMark[] } {
  const own = marks.filter((mark) => mark.elapsedMs < claimAllBefore);
  const rest = marks.filter((mark) => mark.elapsedMs >= claimAllBefore);
  const parts: DockInsertionPart[] = [];
  let next = 0;
  for (const segment of timedSegments(utterance)) {
    while (next < own.length && own[next].elapsedMs <= segment.startMs) {
      parts.push({ kind: 'mark', markId: own[next].markId });
      next += 1;
    }
    parts.push({ kind: 'text', text: segment.text });
  }
  for (; next < own.length; next += 1) parts.push({ kind: 'mark', markId: own[next].markId });
  return { parts, rest };
}

/** Space between this commit and earlier dictated text in the same session. */
function withLeadingSpace(parts: DockInsertionPart[], needed: boolean): DockInsertionPart[] {
  if (!needed || parts.length === 0) return parts;
  const [first, ...tail] = parts;
  // An utterance that opens with punctuation finishes the previous one: no space.
  if (first.kind === 'text' && ATTACHES_LEFT.test(first.text)) return parts;
  return first.kind === 'text'
    ? [{ kind: 'text', text: ` ${first.text}` }, ...tail]
    : [{ kind: 'text', text: ' ' }, ...parts];
}

/**
 * Pure reducer over helper events. Finals commit strictly in utterance order
 * (a late final from an earlier utterance holds back later ones), each exactly
 * once; marks join the first utterance whose audio ends after the click.
 */
export function createDockSpeechTranscript(sessionId: string) {
  const utterances = new Map<number, Utterance>();
  let marks: PendingMark[] = [];
  let nextCommit = 0;
  let committedAny = false;
  let ended = false;

  const ordered = () => [...utterances.values()].sort((a, b) => a.id - b.id);

  /** `force` seals every remaining utterance, skipping ids the helper never sent. */
  function flushCommits(force = false): DockSpeechCommit[] {
    const commits: DockSpeechCommit[] = [];
    for (;;) {
      if (force && !utterances.has(nextCommit) && utterances.size)
        nextCommit = Math.min(...utterances.keys());
      const utterance = utterances.get(nextCommit);
      if (utterance && force) utterance.final = true;
      if (!utterance?.final) break;
      const end = utterance.endMs ?? Number.POSITIVE_INFINITY;
      const { parts, rest } = weave(utterance, marks, end);
      marks = rest;
      utterances.delete(nextCommit);
      const normalized = normalizeParts(parts);
      if (normalized.length) {
        commits.push({
          id: `${sessionId}:${nextCommit}`,
          parts: withLeadingSpace(normalized, committedAny),
        });
        committedAny = true;
      }
      nextCommit += 1;
    }
    return commits;
  }

  function interim(): DockInsertionPart[] {
    let pending = marks;
    const parts: DockInsertionPart[] = [];
    for (const utterance of ordered()) {
      if (utterance.id < nextCommit) continue;
      const { parts: woven, rest } = weave(
        utterance,
        pending,
        utterance.endMs ?? Number.POSITIVE_INFINITY,
      );
      pending = rest;
      parts.push(...woven, { kind: 'text', text: ' ' });
    }
    parts.push(
      ...pending.map((mark): DockInsertionPart => ({ kind: 'mark', markId: mark.markId })),
    );
    return withLeadingSpace(normalizeParts(parts), committedAny);
  }

  return {
    apply(event: DockSpeechEvent): DockSpeechTranscriptUpdate | null {
      if (ended) return null;
      switch (event.type) {
        case 'transcript': {
          if (event.utterance < nextCommit) return null;
          const known = utterances.get(event.utterance);
          if (known && (known.final || known.revision >= event.revision)) return null;
          utterances.set(event.utterance, {
            id: event.utterance,
            revision: event.revision,
            final: event.isFinal,
            text: event.text,
            startMs: event.startMs,
            endMs: event.endMs,
            segments: event.segments,
          });
          return { commits: flushCommits(), interim: interim() };
        }
        case 'mark': {
          if (marks.some((mark) => mark.markId === event.markId)) return null;
          marks = [...marks, { markId: event.markId, elapsedMs: event.elapsedMs }].sort(
            (a, b) => a.elapsedMs - b.elapsedMs,
          );
          return { commits: [], interim: interim() };
        }
        case 'ended': {
          ended = true;
          // Seal anything the helper never finalized (crash, watchdog); a
          // cancel drops unfinalized speech but keeps every accepted mark.
          const commits = event.reason === 'cancelled' ? [] : flushCommits(true);
          const leftover = normalizeParts(
            marks.map((mark): DockInsertionPart => ({ kind: 'mark', markId: mark.markId })),
          );
          marks = [];
          return {
            commits,
            interim: [],
            ended: {
              reason: event.reason,
              trailing: leftover.length
                ? {
                    id: `${sessionId}:end`,
                    parts: withLeadingSpace(leftover, committedAny || commits.length > 0),
                  }
                : null,
            },
          };
        }
        default:
          return null;
      }
    },
  };
}
