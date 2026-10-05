import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
type Direction = 'LR' | 'RL' | 'TB' | 'TD' | 'BT';
const machineSource = `flowchart LR
  A[Workspace tab] --> B[Remembered machine]
  B --> C[Intent chooses connection]
  C --> D[Local]
  C --> E[LAN]
  C --> F[Tailcat]
  D --> G[Same trusted intentd]
  E --> G
  F --> G`;
const links = ['A_B', 'B_C', 'C_D', 'C_E', 'C_F', 'D_G', 'E_G', 'F_G'];

async function mountNote(page: Page, source: string, width: number) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=light&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible();
  await page.evaluate(
    async ({ source, width }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'authored-direction-host';
      host.style.cssText = `width:${width}px;height:960px;margin:0 auto`;
      document.body.replaceChildren(host);
      // Actual NoteWithComments/TipTap embedding, not the modeled workbench note shell.
      // No note ID, persistence callback, clipboard action or native session is used.
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'synthetic-authored-direction',
            title: 'Synthetic direction test',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
          content: `## Remember the machine, not its address\n\n~~~mermaid\n${source}\n~~~\n\nFollowing note text.`,
          editable: false,
          showSuggestions: false,
          showComments: false,
        },
      });
      const frames: { generation: string | undefined; dx: number; dy: number }[] = [];
      Object.assign(window, { directionFrames: frames });
      const sample = () => {
        const root = host.querySelector<HTMLElement>('.mermaid-renderer');
        const shape = (id: string) =>
          root?.querySelector(`g.node[id*="flowchart-${id}-"] > .label-container`);
        const a = shape('A')?.getBoundingClientRect();
        const c = shape('C')?.getBoundingClientRect();
        if (a?.width && c?.width && frames.length < 1000)
          frames.push({
            generation: root?.dataset.renderGeneration,
            dx: c.x + c.width / 2 - a.x - a.width / 2,
            dy: c.y + c.height / 2 - a.y - a.height / 2,
          });
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    },
    { source, width },
  );
}

async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('.node-mermaidBlock .mermaid-renderer');
  await expect(root).toHaveAttribute('data-render-settled', 'true');
  await expect(root.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
  // A note's intrinsic-width observer can schedule another render after the first
  // settled marker. Require stable painted geometry, not a stale boolean.
  await root.evaluate(
    (root) =>
      new Promise<void>((resolve, reject) => {
        let previous = '';
        let stable = 0;
        const started = performance.now();
        const sample = () => {
          const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg');
          const signature = JSON.stringify([
            root.getBoundingClientRect().toJSON(),
            svg?.getBoundingClientRect().toJSON(),
            svg?.getAttribute('viewBox'),
            root.getAttribute('data-render-generation'),
          ]);
          stable =
            signature === previous &&
            root.getAttribute('data-render-settled') === 'true' &&
            svg?.dataset.layoutSettled === 'true'
              ? stable + 1
              : 0;
          previous = signature;
          if (stable >= 8) resolve();
          else if (performance.now() - started > 10000)
            reject(new Error('Note geometry did not settle'));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  return root.evaluate((root) => {
    const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
    const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport')!;
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
      const shape = node.querySelector('.label-container')!;
      const label = node.querySelector<SVGGraphicsElement>('.label')!;
      const text = node.querySelector('.nodeLabel p')!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const matrix = label.getScreenCTM()!;
      return {
        id: node.id.match(/flowchart-([A-Z])-/)?.[1],
        box: rect(shape),
        label: range.getBoundingClientRect().toJSON(),
        text: text.textContent,
        fontSize: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b),
      };
    });
    const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      return {
        id: path.id.match(/L_([A-Z]_[A-Z])_/)?.[1],
        marker: path.getAttribute('marker-end'),
        points: Array.from({ length: 51 }, (_, i) => {
          const p = path.getPointAtLength((length * i) / 50).matrixTransform(matrix);
          return { x: p.x, y: p.y };
        }),
      };
    });
    return {
      nodes,
      edges,
      viewport: rect(viewport),
      svg: rect(svg),
      renderer: rect(root),
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      overflow: getComputedStyle(viewport).overflowX,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

type Geometry = Awaited<ReturnType<typeof geometry>>;
function directionViolations(g: Geometry, direction: Direction) {
  const axis = direction === 'LR' || direction === 'RL' ? 'x' : 'y';
  const size = axis === 'x' ? 'width' : 'height';
  const sign = direction === 'RL' || direction === 'BT' ? -1 : 1;
  const errors: string[] = [];
  for (const link of links) {
    const [from, to] = link.split('_');
    const a = g.nodes.find((n) => n.id === from)!;
    const b = g.nodes.find((n) => n.id === to)!;
    if ((b.box[axis] + b.box[size] / 2 - a.box[axis] - a.box[size] / 2) * sign <= 4)
      errors.push(`${link}: node direction`);
    const edge = g.edges.find((e) => e.id === link)!;
    if ((edge.points.at(-1)![axis] - edge.points[0][axis]) * sign <= 4)
      errors.push(`${link}: painted edge direction`);
  }
  return errors;
}

async function verifyStage(
  page: Page,
  info: TestInfo,
  source: string,
  direction: Direction,
  stage: string,
) {
  const g = await geometry(page);
  await writeFile(info.outputPath(`${stage}.json`), JSON.stringify(g, null, 2));
  await page
    .locator('#authored-direction-host')
    .screenshot({ path: info.outputPath(`${stage}.png`) });
  expect(g.nodes).toHaveLength(7);
  expect(g.edges.map((e) => e.id).sort()).toEqual([...links].sort());
  expect(directionViolations(g, direction)).toEqual([]);
  for (const node of g.nodes) {
    expect(node.fontSize, `${stage}: ${node.text} readable`).toBeGreaterThanOrEqual(11.9);
    expect(node.label.x).toBeGreaterThanOrEqual(node.box.x - 1);
    expect(node.label.right).toBeLessThanOrEqual(node.box.right + 1);
    expect(node.label.y).toBeGreaterThanOrEqual(node.box.y - 1);
    expect(node.label.bottom).toBeLessThanOrEqual(node.box.bottom + 1);
  }
  expect(g.edges.every((e) => Boolean(e.marker))).toBe(true);
  if (direction === 'LR' || direction === 'RL') {
    const branchX = g.nodes
      .filter((n) => ['D', 'E', 'F'].includes(n.id))
      .map((n) => n.box.x + n.box.width / 2);
    expect(Math.max(...branchX) - Math.min(...branchX), 'parallel branch rank').toBeLessThan(1);
  }
  expect(g.pageOverflow, 'scroll belongs to diagram, not page').toBeLessThanOrEqual(1);
  const sourceButton = page
    .locator('.mermaid-renderer')
    .getByRole('button', { name: 'View source', exact: true });
  await sourceButton.focus();
  await sourceButton.press('Enter');
  expect(await page.locator('.mermaid-source pre').textContent()).toBe(source);
  await sourceButton.press('Enter');
  return g;
}

for (const direction of ['LR', 'RL', 'TB', 'TD', 'BT'] as const) {
  for (const initialWidth of [360, 1000]) {
    test(`actual note preserves ${direction} from ${initialWidth}px through resize-back`, async ({
      page,
    }, info) => {
      const source = machineSource.replace('flowchart LR', `flowchart ${direction}`);
      await mountNote(page, source, initialWidth);
      const widths = [initialWidth, initialWidth === 360 ? 1000 : 360, initialWidth];
      for (const [index, width] of widths.entries()) {
        if (index) {
          await page.locator('#authored-direction-host').evaluate((host, width) => {
            host.style.width = `${width}px`;
          }, width);
          // Allow ResizeObserver delivery and any render it schedules before reading settled.
          await page.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
              ),
          );
        }
        const g = await verifyStage(page, info, source, direction, `${index}-${width}`);
        if (width === 360 && (direction === 'LR' || direction === 'RL')) {
          expect(g.renderer.width).toBeLessThan(360);
          expect(g.scrollWidth - g.clientWidth).toBeGreaterThan(100);
          expect(g.overflow).toBe('auto');
          const viewport = page.locator('.mermaid-svg-viewport');
          await viewport.hover();
          await page.mouse.wheel(g.scrollWidth - g.clientWidth - g.scrollLeft, 0);
          await expect
            .poll(async () => (await geometry(page)).scrollLeft)
            .toBe(g.scrollWidth - g.clientWidth);
          const scrolled = await geometry(page);
          expect(scrolled.scrollLeft).toBeGreaterThan(100);
          expect(scrolled.svg.right).toBeLessThanOrEqual(scrolled.viewport.right + 1);
          expect(directionViolations(scrolled, direction)).toEqual([]);
          await page.mouse.wheel(-scrolled.scrollLeft, 0);
          await expect.poll(async () => (await geometry(page)).scrollLeft).toBe(0);
          const restored = await geometry(page);
          expect(restored.svg.x).toBeGreaterThanOrEqual(restored.viewport.x - 1);
        }
      }
      const frames = await page.evaluate(
        () =>
          (
            window as typeof window & {
              directionFrames: { generation: string; dx: number; dy: number }[];
            }
          ).directionFrames,
      );
      await writeFile(
        info.outputPath('painted-frames.json'),
        JSON.stringify(
          { source, sha256: createHash('sha256').update(source).digest('hex'), frames },
          null,
          2,
        ),
      );
      expect(frames.length).toBeGreaterThan(0);
      const sign = direction === 'RL' || direction === 'BT' ? -1 : 1;
      const horizontal = direction === 'LR' || direction === 'RL';
      expect(
        frames.filter((f) => (horizontal ? f.dx : f.dy) * sign <= 4),
        'every painted main-chain sample, including first render',
      ).toEqual([]);
    });
  }
}

test('painted direction oracle rejects moved nodes and reversed edge paint independently', async ({
  page,
}) => {
  await mountNote(page, machineSource, 1000);
  const g = await geometry(page);
  await page
    .locator('g.node[id*="flowchart-B-"]')
    .evaluate((node) => node.setAttribute('transform', 'translate(-1000, 0)'));
  expect(directionViolations(await geometry(page), 'LR')).toContain('A_B: node direction');
  const edge = g.edges.find((e) => e.id === 'A_B')!;
  edge.points.reverse();
  expect(directionViolations(g, 'LR')).toContain('A_B: painted edge direction');
});
