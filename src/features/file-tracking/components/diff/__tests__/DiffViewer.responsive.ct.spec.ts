import { expect, test, type Locator } from '@playwright/experimental-ct-svelte';
import DiffViewer from '../DiffViewer.svelte';
import VirtualizedDiffHost from './VirtualizedDiffHost.svelte';

const fileContents = {
  oldContent: 'const greeting = "Hello";\n',
  newContent: 'const greeting = "Welcome";\n',
};

const patch = [
  'diff --git a/greeting.ts b/greeting.ts',
  '--- a/greeting.ts',
  '+++ b/greeting.ts',
  '@@ -1 +1 @@',
  '-const greeting = "Hello";',
  '+const greeting = "Welcome";',
  '',
].join('\n');

async function measureChangedLines(component: Locator) {
  const deletion = await component
    .locator('[data-line][data-line-type="change-deletion"]')
    .first()
    .boundingBox();
  const addition = await component
    .locator('[data-line][data-line-type="change-addition"]')
    .first()
    .boundingBox();
  if (!deletion || !addition) return null;
  return {
    stacked:
      Math.abs(deletion.x - addition.x) < 1 && addition.y >= deletion.y + deletion.height - 1,
    split: addition.x >= deletion.x + deletion.width - 1 && Math.abs(deletion.y - addition.y) < 1,
  };
}

for (const input of ['files', 'patch'] as const) {
  test(`${input}: split diffs stack below 640px and restore on panel expansion`, async ({
    mount,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const props = {
      ...(input === 'files' ? fileContents : { patch }),
      fileName: 'greeting.ts',
      viewMode: 'split' as const,
      style: 'width: 640px',
    };
    const component = await mount(DiffViewer, { props });
    await expect.poll(async () => (await measureChangedLines(component))?.split).toBe(true);

    await component.update({ props: { ...props, style: 'width: 639px' } });
    await expect.poll(async () => (await measureChangedLines(component))?.stacked).toBe(true);

    await component.update({ props: { ...props, style: 'width: 100%' } });
    await page.setViewportSize({ width: 420, height: 800 });
    await expect.poll(async () => (await measureChangedLines(component))?.stacked).toBe(true);
    await component.screenshot({ path: `.demo-artifacts/sandbox/diff-${input}-narrow.png` });

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect.poll(async () => (await measureChangedLines(component))?.split).toBe(true);
    await component.screenshot({ path: `.demo-artifacts/sandbox/diff-${input}-wide.png` });
  });
}

test('an explicitly unified diff stays stacked when its panel widens', async ({ mount, page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  const component = await mount(DiffViewer, {
    props: { ...fileContents, fileName: 'greeting.ts', viewMode: 'unified' },
  });
  await expect.poll(async () => (await measureChangedLines(component))?.stacked).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await measureChangedLines(component))?.stacked).toBe(true);
});

test('virtualized diffs restore split geometry after a narrow viewport', async ({
  mount,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const component = await mount(VirtualizedDiffHost);
  await expect.poll(async () => (await measureChangedLines(component))?.split).toBe(true);
  await page.setViewportSize({ width: 420, height: 800 });
  await expect.poll(async () => (await measureChangedLines(component))?.stacked).toBe(true);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect.poll(async () => (await measureChangedLines(component))?.split).toBe(true);
});
