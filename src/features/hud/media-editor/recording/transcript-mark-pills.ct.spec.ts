import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import DockRecordingTranscript from './DockRecordingTranscript.svelte';

/**
 * Annotation numbers inline in an editable transcript: rounded, bright, semibold chips that
 * sit on the text line with ordinary word gaps, while the text itself (words, order, the
 * editable runs) stays exactly as recognized.
 */
const words = 'Here the header wraps, and then this button is misaligned on hover'
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

test('transcript mark pills are round, bright chips on the text line', async ({
  mount,
  page,
}, info) => {
  await page.setViewportSize({ width: 360, height: 220 });
  const marks = [mark('m1', 400), mark('m2', 2400), mark('m3', 5200)];
  const component = await mount(DockRecordingTranscript, {
    props: {
      transcript: { status: 'ready', revision: 1, words },
      batches: [{ id: 'b1', atMs: 0, clearAtMs: null }],
      marks,
      currentMs: 0,
      markNumbers: { m1: 1, m2: 2, m3: 12 },
      onSeek: () => {},
      onMark: () => {},
      onWordEdits: () => {},
    },
  });
  const pills = component.locator('[data-mark-pill]');
  await expect(pills).toHaveCount(3);
  const m = await page.evaluate(() => {
    const text = document.querySelector('.text') as HTMLElement;
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight);
    const pills = Array.from(document.querySelectorAll<HTMLElement>('[data-mark-pill]'));
    const runs = Array.from(document.querySelectorAll<HTMLElement>('[data-transcript-text]'));
    // Gap between the end of the text run before a pill and the pill, vs an ordinary word gap.
    const space = (() => {
      const probe = document.createElement('span');
      probe.textContent = ' ';
      text.append(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    })();
    const gaps = pills.map((pill) => {
      const before = pill.closest('div[style*="contents"]')?.previousElementSibling ?? null;
      if (!(before instanceof HTMLElement) || !before.matches('[data-transcript-text]'))
        return null;
      const range = document.createRange();
      range.selectNodeContents(before);
      const rects = range.getClientRects();
      const end = rects[rects.length - 1]!;
      const box = pill.getBoundingClientRect();
      return Math.abs(box.top - end.top) < lineHeight ? box.left - end.right : null;
    });
    return {
      lineHeight,
      space,
      gaps,
      pills: pills.map((pill) => {
        const css = getComputedStyle(pill);
        const box = pill.getBoundingClientRect();
        const label = pill.querySelector('[data-slot="button-label"]')!.getBoundingClientRect();
        return {
          text: pill.textContent?.trim(),
          height: box.height,
          width: box.width,
          radius: parseFloat(css.borderTopLeftRadius),
          weight: Number(css.fontWeight),
          background: css.backgroundColor,
          // The number is centered: no trailing whitespace inside the chip.
          offCenter: Math.abs(label.left + label.width / 2 - (box.left + box.width / 2)),
        };
      }),
      text: runs.map((run) => run.textContent).join(' | '),
    };
  });
  // The words are exactly the recognized ones, split only where the numbers sit.
  expect(m.text.replace(/ \| /g, ' ')).toBe(words.map((word) => word.text).join(' '));
  for (const pill of m.pills) {
    expect(pill.height).toBeLessThanOrEqual(m.lineHeight);
    expect(pill.radius).toBeGreaterThanOrEqual(pill.height / 2 - 0.5);
    expect(pill.weight).toBeGreaterThanOrEqual(600);
    expect(pill.offCenter).toBeLessThan(1);
  }
  expect(m.pills.map((pill) => pill.text)).toEqual(['1', '2', '12']);
  // A word gap before each pill that follows text on its line: about one space, not two.
  for (const gap of m.gaps.filter((value): value is number => value !== null))
    expect(gap).toBeLessThan(m.space * 1.6);
  await component.screenshot({ path: info.outputPath('20-transcript-mark-pills.png') });
  await writeFile(info.outputPath('transcript-pills-receipt.json'), JSON.stringify(m, null, 2));
});
