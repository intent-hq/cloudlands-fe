import { expect, test } from '@playwright/experimental-ct-svelte';
import type { Locator, Page } from '@playwright/test';
import MermaidBlockLaneHarness from './MermaidBlockLaneHarness.svelte';

// Lane contract (intent-hq/intent#4660): a failed Mermaid render has no
// diagram to show, so its error card stays in the prose column at any host
// width. A successful render keeps the wide diagram lane, which only differs
// from the prose column once the host is wider than the prose column plus
// its padding — 1336px is the reference wide host, 900px the narrow one.
const WIDE_HOST = 1336;
const NARROW_HOST = 900;

const INVALID_CODE = 'flowchart LR\n  A --> \n  ==> ??? (((\n';

// Invalid source long enough to outgrow either prose column when its details
// are expanded, including one unbroken token wider than the wide host.
const LONG_INVALID_CODE = [
  INVALID_CODE,
  ...Array.from({ length: 40 }, (_, i) => `  step${i} --> ??? broken edge number ${i} (((`),
  `  ${'x'.repeat(1_600)}`,
].join('\n');

// Wide enough for the SVG to outgrow the prose column on the wide host.
const WIDE_VALID_CODE = [
  'flowchart LR',
  ...Array.from({ length: 12 }, (_, i) => `  N${i}[Stage ${i} long label] --> N${i + 1}`),
  '  N12[Done]',
].join('\n');

const width = (locator: Locator) => locator.evaluate((node) => node.getBoundingClientRect().width);

const horizontalBounds = (locator: Locator) =>
  locator.evaluate((node) => {
    const { left, right } = node.getBoundingClientRect();
    return { left, right };
  });

const horizontalOverflow = (locator: Locator) =>
  locator.evaluate((node) => node.scrollWidth - node.clientWidth);

const afterTwoFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

async function mountHarness(
  mount: Parameters<Parameters<typeof test>[1]>[0]['mount'],
  page: Page,
  props: { code: string; hostWidth: number },
) {
  await page.setViewportSize({ width: props.hostWidth + 64, height: 900 });
  const component = await mount(MermaidBlockLaneHarness, { props });
  return {
    component,
    block: component.locator('[data-node-view-wrapper][data-render-state]'),
    paragraph: component.getByText('Paragraph before the diagram.'),
    host: page.getByTestId('note-host'),
  };
}

async function expectRenderState(block: Locator, state: 'rendered' | 'error') {
  await expect(block).toHaveAttribute('data-render-state', state, { timeout: 15_000 });
}

for (const hostWidth of [WIDE_HOST, NARROW_HOST]) {
  test(`failed render card matches the prose column at ${hostWidth}px`, async ({ mount, page }) => {
    const { block, paragraph, host } = await mountHarness(mount, page, {
      code: LONG_INVALID_CODE,
      hostWidth,
    });
    await expectRenderState(block, 'error');

    const paragraphWidth = await width(paragraph);
    expect(paragraphWidth).toBeGreaterThan(0);
    expect(Math.abs((await width(block)) - paragraphWidth)).toBeLessThanOrEqual(2);

    // Expanding the source details must keep the card in the prose column
    // rather than letting the long source push it (or the host) wider.
    const details = block.locator('details');
    await details.locator('summary').click();
    await expect(details).toHaveAttribute('open');
    await afterTwoFrames(page);

    const paragraphBounds = await horizontalBounds(paragraph);
    for (const target of [block, details]) {
      const bounds = await horizontalBounds(target);
      expect(bounds.left).toBeGreaterThanOrEqual(paragraphBounds.left - 2);
      expect(bounds.right).toBeLessThanOrEqual(paragraphBounds.right + 2);
    }
    expect(Math.abs((await width(block)) - paragraphWidth)).toBeLessThanOrEqual(2);
    expect(await horizontalOverflow(host)).toBe(0);
  });
}

test(`successful render keeps the wide lane at ${WIDE_HOST}px`, async ({ mount, page }) => {
  const { block, paragraph } = await mountHarness(mount, page, {
    code: WIDE_VALID_CODE,
    hostWidth: WIDE_HOST,
  });
  await expectRenderState(block, 'rendered');

  const blockWidth = await width(block);
  expect(blockWidth).toBeGreaterThan(await width(paragraph));
  await afterTwoFrames(page);
  expect(await width(block)).toBeCloseTo(blockWidth, 0);
});

test('lane follows the render state without oscillating when the source changes', async ({
  mount,
  page,
}) => {
  const { component, block, paragraph } = await mountHarness(mount, page, {
    code: INVALID_CODE,
    hostWidth: WIDE_HOST,
  });
  await expectRenderState(block, 'error');
  const paragraphWidth = await width(paragraph);

  await component.update({ props: { code: WIDE_VALID_CODE, hostWidth: WIDE_HOST } });
  await expectRenderState(block, 'rendered');
  const renderedWidth = await width(block);
  expect(renderedWidth).toBeGreaterThan(paragraphWidth);
  await afterTwoFrames(page);
  expect(await width(block)).toBeCloseTo(renderedWidth, 0);

  await component.update({ props: { code: INVALID_CODE, hostWidth: WIDE_HOST } });
  await expectRenderState(block, 'error');
  expect(Math.abs((await width(block)) - paragraphWidth)).toBeLessThanOrEqual(2);
  await afterTwoFrames(page);
  expect(Math.abs((await width(block)) - paragraphWidth)).toBeLessThanOrEqual(2);
});
