import { expect, test } from '../../../../test/ct-test';
import DockRecordingTranscript from './DockRecordingTranscript.svelte';

// A stand-in for a spoken bug report (the person's own sentence is not in the fixture).
const words = (
  'So when I open the dock here and click the screenshot button, the editor takes a ' +
  'second to show up, the dock stays expanded behind it, and this header and that ' +
  'link icon both shift when I hover over them'
)
  .split(' ')
  .map((text, index) => ({
    id: `w${index}`,
    text,
    startMs: index * 400,
    endMs: index * 400 + 300,
    alignment: 'word' as const,
  }));
const mark = (id: string, atMs: number) => ({
  id,
  atMs,
  batchId: 'b1',
  source: 'recording' as const,
  kind: 'click' as const,
  included: true,
  geometry: { kind: 'point' as const, x: 10, y: 10 },
  label: '',
  note: '',
  context: { selector: null, text: null, url: null },
});

test('transcript markers preserve recognized words and number mapping', async ({ mount }) => {
  // Markers 1–8 across the sentence, each before the word spoken when it was made.
  const at = [2, 6, 10, 15, 19, 26, 31, 36];
  const marks = at.map((word, index) => mark(`m${index + 1}`, word * 400));
  const component = await mount(DockRecordingTranscript, {
    props: {
      transcript: { status: 'ready', revision: 1, words },
      batches: [{ id: 'b1', atMs: 0, clearAtMs: null }],
      marks,
      currentMs: 0,
      markNumbers: Object.fromEntries(marks.map((row, index) => [row.id, index + 1])),
      onSeek: () => {},
      onMark: () => {},
      onWordEdits: () => {},
    },
  });
  const pills = component.locator('[data-mark-pill]');
  await expect(pills).toHaveCount(8);
  const text = await component.locator('[data-transcript-text]').allTextContents();
  expect(text.join(' ')).toBe(words.map((word) => word.text).join(' '));
  await expect(pills).toHaveText(['1', '2', '3', '4', '5', '6', '7', '8']);
});
