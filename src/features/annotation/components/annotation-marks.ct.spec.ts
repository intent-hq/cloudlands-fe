import { expect, test } from '../../../test/ct-test';
import AnnotationMarks from './AnnotationMarks.svelte';

for (const theme of ['light', 'dark'] as const) {
  test(`smooth annotation marks stay clear over a ${theme} screen`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 900, height: 600 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
    await page.addStyleTag({
      content: `
      body { background: ${theme === 'light' ? '#f9fbff' : '#101821'}; }
      .annotation-test-content { position: fixed; inset: 64px 56px; color: ${theme === 'light' ? '#344251' : '#c0d0e0'}; font: 18px/2.5 Inter, sans-serif; }
    `,
    });
    await page.evaluate(() => {
      const text = document.createElement('div');
      text.className = 'annotation-test-content';
      text.innerText =
        'Workspace review\nThe highlighted area needs a little more room.\nKeep the controls close to the content.\nReview changes before sending feedback.';
      document.body.prepend(text);
    });
    const points = Array.from({ length: 60 }, (_, i) => {
      const angle = (i / 59) * Math.PI * 1.85;
      return { x: 360 + Math.cos(angle) * 270, y: 230 + Math.sin(angle) * 105 };
    });
    const marks = await mount(AnnotationMarks, {
      props: {
        width: 900,
        height: 600,
        actions: [
          { kind: 'stroke', points },
          { kind: 'rectangle', origin: { x: 80, y: 365 }, end: { x: 510, y: 465 } },
          { kind: 'arrow', origin: { x: 680, y: 350 }, end: { x: 530, y: 400 } },
          { kind: 'pin', point: { x: 690, y: 170 }, number: 1, elapsedMs: 0 },
          { kind: 'stroke', points: [{ x: 660, y: 260 }] },
        ],
      },
    });
    const path = marks.locator('.marks > path').first();
    await expect(path).toBeVisible();
    const bounds = await path.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeGreaterThan(500);
    expect(bounds!.height).toBeGreaterThan(190);
    await expect(marks.locator('.pin text')).toHaveText('1');
    await page.screenshot({ path: testInfo.outputPath(`annotation-ink-${theme}.png`) });
  });
}
