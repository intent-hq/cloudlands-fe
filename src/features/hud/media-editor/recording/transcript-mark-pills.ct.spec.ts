import { writeFile } from 'node:fs/promises';
import { expect, test } from '../../../../test/ct-test';
import DockRecordingTranscript from './DockRecordingTranscript.svelte';

/**
 * Annotation numbers inline in an editable transcript: bright, semibold chips with ~4px corners and no border that
 * sit on the text line with ordinary word gaps, while the text itself (words, order, the
 * editable runs) stays exactly as recognized.
 */
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

for (const [name, width] of [
  ['normal', 520],
  ['narrow', 300],
] as const)
  test(`transcript mark pills are bright, borderless chips on the text line (dark, ${name})`, async ({
    mount,
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 320 });
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      document.body.style.background = 'hsl(var(--background))';
      document.body.style.color = 'hsl(var(--foreground))';
    });
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
            border: css.borderTopWidth,
            shadow: css.boxShadow,
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
      expect(Math.abs(pill.radius - 4)).toBeLessThan(0.5);
      expect(pill.border).toBe('0px');
      expect(pill.shadow).toBe('none');
      expect(pill.weight).toBeGreaterThanOrEqual(600);
      expect(pill.offCenter).toBeLessThan(1);
    }
    expect(m.pills.map((pill) => pill.text)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    // A word gap before each pill that follows text on its line: about one space, not two.
    for (const gap of m.gaps.filter((value): value is number => value !== null))
      expect(gap).toBeLessThan(m.space * 1.6);
    await component.screenshot({
      path: info.outputPath(`20-transcript-mark-pills-dark-${name}.png`),
    });
    await writeFile(
      info.outputPath(`transcript-pills-dark-${name}-receipt.json`),
      JSON.stringify(m, null, 2),
    );
  });
