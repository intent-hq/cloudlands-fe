/**
 * Failure modes covered: interim duplicated instead of replaced; a final
 * committed twice or out of utterance order; a click chip on the wrong word or
 * utterance; marks lost when no speech follows; cancel leaking unfinalized
 * text; malformed helper lines accepted.
 */
import { describe, expect, it } from 'vitest';
import {
  createDockSpeechTranscript,
  parseDockSpeechEvent,
  type DockSpeechEvent,
  type DockSpeechSegment,
} from './dock-speech';

const words = (startMs: number, ...items: string[]): DockSpeechSegment[] =>
  items.flatMap((text, index) => {
    const at = startMs + index * 400;
    const segment = { text, startMs: at, endMs: at + 300 };
    return index === items.length - 1
      ? [segment]
      : [segment, { text: ' ', startMs: null, endMs: null }];
  });

const transcript = (
  utterance: number,
  revision: number,
  isFinal: boolean,
  segments: DockSpeechSegment[],
): DockSpeechEvent => {
  const timed = segments.filter((s) => s.startMs !== null);
  return {
    type: 'transcript',
    utterance,
    revision,
    isFinal,
    text: segments.map((s) => s.text).join(''),
    startMs: timed[0]?.startMs ?? null,
    endMs: timed.at(-1)?.endMs ?? null,
    segments,
  };
};

describe('dock speech transcript', () => {
  it('replaces interim in place and commits each utterance once', () => {
    const model = createDockSpeechTranscript('s1');
    expect(model.apply(transcript(0, 1, false, words(0, 'Closer')))).toEqual({
      commits: [],
      interim: [{ kind: 'text', text: 'Closer' }],
    });
    expect(model.apply(transcript(0, 2, false, words(0, 'Closer', 'but')))?.interim).toEqual([
      { kind: 'text', text: 'Closer but' },
    ]);
    const final = model.apply(transcript(0, 3, true, words(0, 'Closer,', 'but')));
    expect(final?.commits).toEqual([
      { id: 's1:0', parts: [{ kind: 'text', text: 'Closer, but' }] },
    ]);
    expect(final?.interim).toEqual([]);
    expect(model.apply(transcript(0, 4, true, words(0, 'again')))).toBeNull();
    expect(model.apply(transcript(1, 1, true, words(2000, 'next')))?.commits).toEqual([
      { id: 's1:1', parts: [{ kind: 'text', text: ' next' }] },
    ]);
  });

  it('ignores stale revisions', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 2, false, words(0, 'newer')));
    expect(model.apply(transcript(0, 1, false, words(0, 'older')))).toBeNull();
  });

  it('holds a later final until earlier utterances finalize', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, false, words(0, 'first')));
    const early = model.apply(transcript(1, 1, true, words(2000, 'second')));
    expect(early?.commits).toEqual([]);
    expect(early?.interim).toEqual([{ kind: 'text', text: 'first second' }]);
    expect(
      model.apply(transcript(0, 2, true, words(0, 'first')))?.commits.map((c) => c.id),
    ).toEqual(['s:0', 's:1']);
  });

  it('places a click after the words that started before it, text/mark/text once', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, false, words(0, 'this')));
    const marked = model.apply({ type: 'mark', markId: 'm1', elapsedMs: 250 });
    expect(marked?.interim).toEqual([
      { kind: 'text', text: 'this ' },
      { kind: 'mark', markId: 'm1' },
    ]);
    expect(model.apply(transcript(0, 2, false, words(0, 'this', 'still')))?.interim).toEqual([
      { kind: 'text', text: 'this ' },
      { kind: 'mark', markId: 'm1' },
      { kind: 'text', text: ' still' },
    ]);
    expect(
      model.apply(transcript(0, 3, true, words(0, 'this', 'still', 'shadows')))?.commits,
    ).toEqual([
      {
        id: 's:0',
        parts: [
          { kind: 'text', text: 'this ' },
          { kind: 'mark', markId: 'm1' },
          { kind: 'text', text: ' still shadows' },
        ],
      },
    ]);
  });

  it('attaches punctuation without a stray space after a chip or between utterances', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, false, words(0, 'looks', 'nice')));
    model.apply({ type: 'mark', markId: 'm1', elapsedMs: 900 });
    // The recognizer finalizes the period as its own segment after the click.
    const first = model.apply(
      transcript(0, 2, true, [
        ...words(0, 'looks', 'nice'),
        { text: '.', startMs: 1000, endMs: 1050 },
      ]),
    );
    expect(first?.commits[0].parts).toEqual([
      { kind: 'text', text: 'looks nice ' },
      { kind: 'mark', markId: 'm1' },
      { kind: 'text', text: '.' },
    ]);
    // A next utterance that opens with punctuation finishes the previous sentence.
    const second = model.apply(transcript(1, 1, true, words(2000, ',', 'then', 'more')));
    expect(second?.commits[0].parts[0]).toEqual({ kind: 'text', text: ', then more' });
  });

  it('gives a click in a pause to the next utterance', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, true, words(0, 'one')));
    model.apply({ type: 'mark', markId: 'm1', elapsedMs: 1000 });
    expect(model.apply(transcript(1, 1, true, words(2000, 'two')))?.commits).toEqual([
      {
        id: 's:1',
        parts: [
          { kind: 'text', text: ' ' },
          { kind: 'mark', markId: 'm1' },
          { kind: 'text', text: ' two' },
        ],
      },
    ]);
  });

  it('flushes unfinalized speech and leftover marks on stop', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, false, words(0, 'half')));
    model.apply({ type: 'mark', markId: 'm1', elapsedMs: 5000 });
    const end = model.apply({ type: 'ended', reason: 'silence', elapsedMs: 13000 });
    expect(end?.commits).toEqual([{ id: 's:0', parts: [{ kind: 'text', text: 'half' }] }]);
    expect(end?.ended).toEqual({
      reason: 'silence',
      trailing: {
        id: 's:end',
        parts: [
          { kind: 'text', text: ' ' },
          { kind: 'mark', markId: 'm1' },
        ],
      },
    });
    expect(model.apply(transcript(1, 1, true, words(0, 'late')))).toBeNull();
  });

  it('keeps words heard before a failed finalization, ending as an error', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, true, words(0, 'final')));
    model.apply(transcript(1, 1, false, words(2000, 'interim')));
    const end = model.apply({
      type: 'error',
      code: 'recognition-failed',
      message: 't',
      fatal: true,
    });
    expect(end).toBeNull();
    const ended = model.apply({ type: 'ended', reason: 'error', elapsedMs: 3000 });
    expect(ended?.commits).toEqual([{ id: 's:1', parts: [{ kind: 'text', text: ' interim' }] }]);
    expect(ended?.ended?.reason).toBe('error');
    expect(ended?.interim).toEqual([]);
  });

  it('drops unfinalized speech on cancel but keeps marks', () => {
    const model = createDockSpeechTranscript('s');
    model.apply(transcript(0, 1, false, words(0, 'half')));
    model.apply({ type: 'mark', markId: 'm1', elapsedMs: 100 });
    const end = model.apply({ type: 'ended', reason: 'cancelled', elapsedMs: 900 });
    expect(end?.commits).toEqual([]);
    expect(end?.ended?.trailing?.parts).toEqual([{ kind: 'mark', markId: 'm1' }]);
  });
});

describe('parseDockSpeechEvent', () => {
  it('accepts helper lines and rejects malformed ones', () => {
    expect(parseDockSpeechEvent('{"type":"level","elapsedMs":33,"level":1.7}')).toEqual({
      type: 'level',
      elapsedMs: 33,
      level: 1,
    });
    expect(parseDockSpeechEvent('{"type":"error","code":"weird","message":"x"}')).toEqual({
      type: 'error',
      code: 'recognition-failed',
      message: 'x',
      fatal: false,
    });
    expect(parseDockSpeechEvent('{"type":"transcript","utterance":0.5}')).toBeNull();
    expect(parseDockSpeechEvent('{"type":"ended","reason":"exploded"}')).toBeNull();
    expect(parseDockSpeechEvent('not json')).toBeNull();
  });
});
