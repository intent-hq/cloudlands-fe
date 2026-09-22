import { expect, test, type Locator, type Page } from '@playwright/test';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const cases = [
  { name: 'desktop dark', width: 960, theme: 'dark' },
  { name: 'narrow light', width: 420, theme: 'light' },
] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openWorkbench(page: Page, width: number, theme: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(
    `${baseUrl}/sandbox/diagram-workbench?state=custom-architecture&theme=${theme}&width=${width}&motion=reduced`,
    { waitUntil: 'domcontentloaded' },
  );
  await expect(page.getByTestId('catalog-scene')).toHaveAttribute('data-preview-stable', 'true', {
    timeout: 120_000,
  });
  await expect(page.locator('[data-diagram-workbench]')).toHaveAttribute(
    'data-diagram-workbench-ready',
    'true',
  );
}

async function customTitleGeometry(root: Locator, revealFinalState = false) {
  if (revealFinalState) await root.locator('[data-diagram-step-index="2"]').click();
  await expect(root.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  return root.evaluate((element) =>
    [...element.querySelectorAll<SVGTextElement>('.group-label')].map((label) => {
      const group = label.parentElement as SVGGElement;
      const frame = group.querySelector<SVGRectElement>('.group-bg')!.getBoundingClientRect();
      const title = label.getBoundingClientRect();
      const matrix = group.getScreenCTM()!;
      const scaleX = Math.hypot(matrix.a, matrix.c);
      const scaleY = Math.hypot(matrix.b, matrix.d);
      const labelStyle = getComputedStyle(label);
      const memberNodes = [
        ...group.ownerSVGElement!.querySelectorAll<HTMLElement>('.diagram-node-html'),
      ].filter((node) => {
        const bounds = node.getBoundingClientRect();
        const x = (bounds.left + bounds.right) / 2;
        const y = (bounds.top + bounds.bottom) / 2;
        return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
      });
      const members = memberNodes.map((node) => node.getBoundingClientRect());
      const contentLeft = Math.min(...members.map((member) => member.left));
      const contentRight = Math.max(...members.map((member) => member.right));
      const actualWidth = frame.width / scaleX;
      const expectedWidth = Math.max(
        (contentRight - contentLeft) / scaleX + 60,
        title.width / scaleX + 48,
      );
      return {
        top: (title.top - frame.top) / scaleY,
        bottom: (Math.min(...members.map((member) => member.top)) - title.bottom) / scaleY,
        left: (title.left - frame.left) / scaleX,
        right: (frame.right - title.right) / scaleX,
        center: Math.abs((title.left + title.right - frame.left - frame.right) / 2) / scaleX,
        fontSize: Number.parseFloat(labelStyle.fontSize),
        fontWeight: Number(labelStyle.fontWeight),
        tracking: Number.parseFloat(labelStyle.letterSpacing),
        opacity: Number(labelStyle.opacity),
        effectiveFontSize: Number.parseFloat(labelStyle.fontSize) * scaleY,
        primaryFontSize: Math.max(
          ...memberNodes.map((node) => {
            const nodeLabel = node.querySelector<HTMLElement>('.node-label');
            const nodeScale = node
              .closest<SVGForeignObjectElement>('foreignObject')
              ?.getScreenCTM();
            return nodeLabel && nodeScale
              ? Number.parseFloat(getComputedStyle(nodeLabel).fontSize) *
                  Math.hypot(nodeScale.a, nodeScale.c)
              : 0;
          }),
        ),
        widthDelta: actualWidth - expectedWidth,
      };
    }),
  );
}

async function mountNoteWithGroups(page: Page, width: number) {
  const diagrams = [
    CUSTOM_WORKBENCH_CASES['custom-architecture'].diagram,
    CUSTOM_WORKBENCH_CASES['custom-service-boundaries'].diagram,
  ];
  const noteModulePath = '/src/lib/components/workspace/NoteWithComments.svelte';
  expect((await page.request.get(`${baseUrl}${noteModulePath}`)).ok()).toBe(true);
  await page.evaluate(
    async ({ diagrams, noteModulePath, width }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import(/* @vite-ignore */ noteModulePath),
      ]);
      const blocks = diagrams.map((diagram) => `\`\`\`diagram\n${JSON.stringify(diagram)}\n\`\`\``);
      const host = document.createElement('div');
      host.id = 'group-title-note-host';
      host.style.cssText = `width:${width}px;height:900px;margin-left:80px`;
      document.body.replaceChildren(host);
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'group-title-note',
            title: 'Group title hierarchy',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-12T00:00:00.000Z',
            updatedAt: '2026-09-12T00:00:00.000Z',
          },
          content: `## Architecture\n\n${blocks.join('\n\n')}\n\nFollowing note text.`,
          editable: true,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { diagrams, noteModulePath, width },
  );
  const lanes = page.locator('#group-title-note-host .node-diagram_block');
  await expect(lanes).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await expect(lanes.nth(0).locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
  await expect(lanes.nth(1).locator('.diagram-renderer')).toHaveAttribute(
    'data-diagram-settled',
    'true',
  );
  return lanes;
}

function expectQuietGroupHeading(group: Awaited<ReturnType<typeof customTitleGeometry>>[number]) {
  expect(group.fontSize).toBe(11);
  expect(group.fontWeight).toBe(500);
  expect(group.tracking / group.fontSize).toBeCloseTo(-0.01, 2);
  expect(group.opacity).toBeGreaterThanOrEqual(0.85);
  expect(group.effectiveFontSize, 'group heading hierarchy').toBeLessThan(group.primaryFontSize);
  expect(Math.abs(group.widthDelta), 'measured and painted title width').toBeLessThanOrEqual(2);
}

async function mermaidTitleGeometry(page: Page) {
  return page.locator('#mermaid-groups').evaluate((element) => {
    const nodes = [...element.querySelectorAll<SVGGElement>('g.node')];
    return [...element.querySelectorAll<SVGGElement>('g.cluster')].map((cluster) => {
      const frame = cluster.querySelector<SVGRectElement>(':scope > rect')!.getBoundingClientRect();
      const title = cluster
        .querySelector<SVGGElement>(':scope > .cluster-label')!
        .getBoundingClientRect();
      const matrix = cluster.getScreenCTM()!;
      const scaleX = Math.hypot(matrix.a, matrix.c);
      const scaleY = Math.hypot(matrix.b, matrix.d);
      const members = nodes
        .map((node) => node.getBoundingClientRect())
        .filter((node) => {
          const x = (node.left + node.right) / 2;
          const y = (node.top + node.bottom) / 2;
          return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom;
        });
      return {
        top: (title.top - frame.top) / scaleY,
        bottom: (Math.min(...members.map((member) => member.top)) - title.bottom) / scaleY,
        left: (title.left - frame.left) / scaleX,
        right: (frame.right - title.right) / scaleX,
      };
    });
  });
}

for (const item of cases) {
  test(`reserves group title space at ${item.name}`, async ({ page }) => {
    await openWorkbench(page, item.width, item.theme);
    expect(
      await page.evaluate(() => ({
        weight: getComputedStyle(document.documentElement)
          .getPropertyValue('--text-caption-weight')
          .trim(),
        tracking: getComputedStyle(document.documentElement)
          .getPropertyValue('--text-caption-tracking')
          .trim(),
      })),
    ).toEqual({ weight: '500', tracking: '-0.01em' });
    const groups = await customTitleGeometry(page.locator('#custom-architecture'), true);
    expect(groups).toHaveLength(2);
    for (const group of groups) {
      expectQuietGroupHeading(group);
      expect(group.top).toBeGreaterThanOrEqual(13);
      expect(group.bottom).toBeGreaterThanOrEqual(35);
      expect(group.left).toBeGreaterThanOrEqual(23);
      expect(group.right).toBeGreaterThanOrEqual(23);
      expect(group.center).toBeLessThanOrEqual(1);
    }

    const clusters = await mermaidTitleGeometry(page);
    expect(clusters).toHaveLength(2);
    for (const cluster of clusters) {
      expect(cluster.top).toBeGreaterThanOrEqual(19);
      expect(cluster.bottom).toBeGreaterThanOrEqual(31);
      expect(cluster.left).toBeGreaterThanOrEqual(19);
      expect(cluster.right).toBeGreaterThanOrEqual(19);
    }

    const noteLanes = await mountNoteWithGroups(page, item.width);
    const noteGroups = [
      ...(await customTitleGeometry(noteLanes.nth(0), true)),
      ...(await customTitleGeometry(noteLanes.nth(1))),
    ];
    expect(noteGroups).toHaveLength(6);
    for (const group of noteGroups) {
      expectQuietGroupHeading(group);
      expect(group.top).toBeGreaterThanOrEqual(15);
      expect(group.bottom).toBeGreaterThanOrEqual(35);
      expect(group.center).toBeLessThanOrEqual(1);
    }
    const statefulFooter = noteLanes.nth(0).locator('.diagram-footer');
    const statefulPresentation = noteLanes.nth(0).locator('[data-diagram-presentation]');
    await expect(statefulFooter).toBeVisible();
    expect((await statefulFooter.boundingBox())!.y).toBeGreaterThan(
      (await statefulPresentation.boundingBox())!.y,
    );
  });
}
