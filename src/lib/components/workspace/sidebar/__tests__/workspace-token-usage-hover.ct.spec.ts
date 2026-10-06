import { expect, test } from '../../../../../test/ct-test';
import WorkspaceTokenUsageAccessibilityHost from './WorkspaceTokenUsageAccessibilityHost.svelte';

for (const scenario of [
  { name: 'fractional segment boundaries', width: 1100 },
  { name: 'small segments in a narrow viewport', width: 280 },
]) {
  test(`keeps hover continuous across ${scenario.name}`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width: scenario.width, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(WorkspaceTokenUsageAccessibilityHost, {
      props: { width: Math.min(304, scenario.width - 48) },
    });
    await component.getByTestId('token-usage-disclosure').click();
    await page.evaluate(() => document.fonts.ready);
    const details = page.getByTestId('token-usage-details');
    const evidence = [];

    for (const name of ['By agent', 'By model']) {
      const group = details.getByRole('radiogroup', { name });
      const controls = group.getByRole('radio');
      await expect(controls).toHaveCount(4);
      const boxes = await controls.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, y: box.top + box.height / 2 };
        }),
      );
      const samples = boxes.flatMap((box, index) => {
        const center = (box.left + box.right) / 2;
        if (index === 0) return [center];
        const boundary = (boxes[index - 1].right + box.left) / 2;
        return [-1, -0.5, 0, 0.5, 1].map((offset) => boundary + offset).concat(center);
      });
      const hits = [];
      for (const x of [...samples, ...samples.toReversed()]) {
        await page.mouse.move(x, boxes[0].y);
        const hovered = group.locator('[role="radio"]:hover');
        await expect(hovered).toHaveCount(1);
        await expect(hovered).toHaveAttribute('data-preview-active', 'true');
        await expect(group.locator('[role="radio"][data-preview-active="true"]')).toHaveCount(1);
        await expect(controls.first()).toBeChecked();
        hits.push({ x, label: await hovered.getAttribute('aria-label') });
      }
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].left - boxes[index - 1].right).toBeLessThanOrEqual(0.01);
      }
      await controls.last().hover();
      await expect(controls.last()).toHaveAttribute('data-preview-active', 'true');
      const path = `.demo-artifacts/token-usage/continuous-hover-${name === 'By agent' ? 'agent' : 'model'}-${scenario.width}.png`;
      await details.screenshot({ path });
      await testInfo.attach(`${name}-hover`, { path, contentType: 'image/png' });
      await page.mouse.move(0, 0);
      await expect(controls.first()).toHaveAttribute('data-preview-active', 'true');
      evidence.push({ name, boxes, hits });
    }
    await testInfo.attach('continuous-hover.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  });
}
