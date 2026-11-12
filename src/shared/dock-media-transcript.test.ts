import { describe, expect, it } from 'vitest';
import {
  defaultDockMediaEdit,
  planDockMediaOutput,
  type DockMediaEditMark,
  type DockMediaSource,
  type DockMediaTranscript,
} from './dock-media-edit';

const mark = (id: string, atMs: number): DockMediaEditMark => ({
  id,
  atMs,
  batchId: 'batch',
  source: 'recording',
  kind: 'box',
  included: true,
  geometry: { kind: 'rect', x: 1, y: 1, w: 5, h: 5 },
  label: '',
  note: '',
  context: { selector: null, text: null, url: null },
});
const source: DockMediaSource = {
  id: 'source',
  revision: 0,
  kind: 'recording',
  attachmentId: 'attachment',
  path: '.intent/attachments/synthetic.mp4',
  width: 64,
  height: 64,
  durationMs: 1000,
  audio: 'available',
  visuals: 'clean',
  batches: [{ id: 'batch', atMs: 0, clearAtMs: null }],
};
const word = (id: string, text: string, startMs: number | null, endMs: number | null) => ({
  id,
  text,
  startMs,
  endMs,
  alignment: startMs === null ? ('untimed' as const) : ('word' as const),
});
function fixture(words: DockMediaTranscript['words'], marks: DockMediaEditMark[] = []) {
  const transcript: DockMediaTranscript = { status: 'ready', revision: 1, words };
  return { transcript, edit: defaultDockMediaEdit(source, marks, transcript) };
}

describe('recording transcript projection', () => {
  it.each(['full', 'highlights'] as const)(
    'keeps lexical order with untimed speech and separate numbered marks in %s video',
    (video) => {
      const { transcript, edit } = fixture(
        [
          word('a', 'First', 100, 200),
          word('b', 'middle', null, null),
          word('c', 'last', 700, 800),
        ],
        [mark('late', 750), mark('early', 150)],
      );
      edit.video = video;
      const plan = planDockMediaOutput(edit, source, transcript);
      expect(plan.errors).toEqual([]);
      expect(plan.transcript).toBe('First middle last\n\n[mark 2: box]\n[mark 1: box]');
      expect(plan.marks.map(({ n, mark: m }) => [n, m.id, m.atMs])).toEqual([
        [1, 'late', 750],
        [2, 'early', 150],
      ]);
      expect(plan.muted).toBe(true);
      expect(transcript.words[1].startMs).toBeNull();
    },
  );
  it('retains a full-source recognition unit crossing the source end without changing its timing', () => {
    const { transcript, edit } = fixture([word('a', 'Complete thought', 900, 1030)]);
    expect(planDockMediaOutput(edit, source, transcript)).toMatchObject({
      errors: [],
      transcript: 'Complete thought',
      kept: [{ startMs: 0, endMs: 1000 }],
    });
    expect(transcript.words[0].endMs).toBe(1030);
  });
  it('preserves corrections, deletions, punctuation and lexical order in the fallback', () => {
    const { transcript, edit } = fixture(
      [
        word('a', 'Hello', 100, 200),
        word('comma', ',', null, null),
        word('b', 'incorrect', null, null),
        word('drop', 'removed', 300, 400),
        word('bang', '!', null, null),
        word('c', 'again', 700, 800),
        word('dot', '.', null, null),
      ],
      [mark('m', 600)],
    );
    edit.wordEdits = { b: 'corrected', drop: '' };
    expect(planDockMediaOutput(edit, source, transcript).transcript).toBe(
      'Hello, corrected again.\n\n[mark 1: box]',
    );
  });
  it('does not block or resurrect the only untimed word after it is deleted', () => {
    const { transcript, edit } = fixture(
      [word('a', 'kept', 100, 200), word('drop', 'removed', null, null)],
      [mark('m', 500)],
    );
    edit.wordEdits = { drop: '' };
    expect(planDockMediaOutput(edit, source, transcript)).toMatchObject({
      errors: [],
      transcript: 'kept\n\n[mark 1: box]',
    });
  });
  it('leaves the normal fully timed interleaving unchanged', () => {
    const { transcript, edit } = fixture(
      [word('a', 'First', 100, 200), word('b', 'last', 700, 800)],
      [mark('m', 500)],
    );
    expect(planDockMediaOutput(edit, source, transcript).transcript).toBe(
      'First [mark 1: box] last',
    );
  });
  it.each(['trim', 'cut'] as const)(
    'still rejects a recognition unit straddling an explicit %s',
    (kind) => {
      const { transcript, edit } = fixture([word('a', 'private speech', 100, 300)]);
      if (kind === 'trim') edit.trim.startMs = 200;
      else edit.cuts = [{ startMs: 200, endMs: 250 }];
      const plan = planDockMediaOutput(edit, source, transcript);
      expect(plan.errors).toContain('timing-unavailable');
      expect(plan.transcript).not.toContain('private speech');
    },
  );
  it.each(['trim', 'cut'] as const)(
    'still rejects untimed lexical content with an explicit %s',
    (kind) => {
      const { transcript, edit } = fixture([word('a', 'unlocated speech', null, null)]);
      if (kind === 'trim') edit.trim.startMs = 100;
      else edit.cuts = [{ startMs: 100, endMs: 200 }];
      const plan = planDockMediaOutput(edit, source, transcript);
      expect(plan.errors).toContain('timing-unavailable');
      expect(plan.transcript).not.toContain('unlocated speech');
    },
  );
  it('keeps excluded speech and its punctuation out of a valid explicit trim', () => {
    const { transcript, edit } = fixture([
      word('a', 'removed', 100, 200),
      word('p', '!', null, null),
      word('b', 'kept', 600, 700),
    ]);
    edit.trim.startMs = 500;
    expect(planDockMediaOutput(edit, source, transcript)).toMatchObject({
      errors: [],
      transcript: 'kept',
    });
  });
});
