import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
const source = `flowchart TB
  subgraph window [One Intent window]
    A[Website tab · This Mac]
    B[Backend tab · Office Linux]
    C[Experiment tab · Home Mac]
  end
  D[Local intentd]
  E[Office intentd]
  F[Home intentd]
  G[Local files and agents]
  H[Office files and agents]
  I[Home files and agents]
  A --> D
  B --> E
  C --> F
  D --> G
  E --> H
  F --> I`;
const ids = 'ABCDEFGHI'.split('');
const links = ['A_D', 'B_E', 'C_F', 'D_G', 'E_H', 'F_I'];
const renamedIds = [
  'tab1',
  'tab2',
  'tab3',
  'daemon1',
  'daemon2',
  'daemon3',
  'files1',
  'files2',
  'files3',
];
const renamedSource = source
  .replace(/\b[A-I]\b/g, (id) => renamedIds[ids.indexOf(id)])
  .replace('window [One Intent window]', 'machines [Independent environments]')
  .replace(/Website|Backend|Experiment/g, 'Project')
  .replace(/Local|Office|Home/g, 'Workspace');

const mixedMembershipSource = `flowchart TB
  subgraph window [Worker processes]
    A[Left start]
    B[Left middle]
    E[Right middle]
  end
  C[Left end]
  D[Right start]
  F[Right end]
  A --> B
  B --> C
  D --> E
  E --> F`;
const reorderedMembershipSource = `flowchart TB
  subgraph workers [Independent workers]
    center2[Second middle]
    center1[First middle]
    start1[First start]
  end
  finish2[Second end]
  start2[Second start]
  finish1[First end]
  center2 --> finish2
  start2 --> center2
  center1 --> finish1
  start1 --> center1`;
const interleavedMembershipSource = `flowchart TB
  A[Left start]
  D[Right start]
  B[Left middle]
  E[Right middle]
  C[Left end]
  F[Right end]
  subgraph window [Worker processes]
    A
    B
    E
  end
  A --> B
  B --> C
  D --> E
  E --> F`;
const wrappedHeaderSource = `flowchart TB
  subgraph workers [Worker processes with a deliberately long descriptive header]
    B[Left middle]
  end
  A[Left start]
  C[Left end]
  D[Right start]
  E[Right middle]
  F[Right end]
  A --> B
  B --> C
  D --> E
  E --> F`;

const walgitSource = `flowchart LR
    Bucket["☁️ S3 / GCS bucket
(the repo's real home)"]

    subgraph Machine["walgit — one binary"]
        direction TB
        Git["git smart HTTP
(push/pull)"]
        Web["Web UI + JSON API"]
        LFS["Git LFS"]
        Bundle["bundle-uri
(static-file clones)"]
    end

    Dev["git push / git clone"] --> Machine
    Machine <-->|"read/write logbook,
cache packs locally"| Bucket
    CDN["CDN / static files"] -.->|"fresh clones skip
the server entirely"| Bucket`;
const reorderedWalgitSource = `flowchart LR
    Static["CDN / static files"] -.->|"fresh clones skip
the server entirely"| Storage
    subgraph Runtime["walgit — one binary"]
        direction TB
        Archive["bundle-uri
(static-file clones)"]
        LargeFiles["Git LFS"]
        Browser["Web UI + JSON API"]
        Http["git smart HTTP
(push/pull)"]
    end
    Runtime <-->|"read/write logbook,
cache packs locally"| Storage["☁️ S3 / GCS bucket
(the repo's real home)"]
    User["git push / git clone"] --> Runtime`;

const nestedHeaderSource = `flowchart TB
  subgraph environment [Worker environment]
    subgraph workers [Worker processes with a deliberately long descriptive header]
      B[Left middle]
    end
    C[Left end]
  end
  A[Left start]
  D[Right start]
  E[Right middle]
  F[Right end]
  A --> B
  B --> C
  D --> E
  E --> F`;

async function mountDiagram(
  page: Page,
  code: string,
  hostKind: 'note' | 'chat',
  motion: 'full' | 'reduced',
) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ reducedMotion: motion === 'full' ? 'no-preference' : 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=light&motion=${motion}`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible();
  await page.evaluate(
    async ({ code, hostKind }) => {
      const { mount } = await import('/@id/svelte');
      const host = document.createElement('div');
      host.id = 'parallel-lanes-host';
      host.style.cssText = `width:${hostKind === 'note' ? 1000 : 864}px;min-height:960px;margin:0 auto`;
      document.body.replaceChildren(host);
      const content = `## Three machines, one window\n\n\`\`\`mermaid\n${code}\n\`\`\`\n\nFollowing text.`;
      if (hostKind === 'note') {
        const { default: NoteWithComments } =
          await import('/src/lib/components/workspace/NoteWithComments.svelte');
        mount(NoteWithComments, {
          target: host,
          props: {
            workspace: {
              id: 'synthetic-parallel-lanes',
              title: 'Synthetic lanes',
              branch: 'test',
              changesets: [],
              timeline: [],
              conversationInfo: [],
              status: 'Active',
              createdAt: '2026-09-15T00:00:00.000Z',
              updatedAt: '2026-09-15T00:00:00.000Z',
            },
            content,
            editable: false,
            showSuggestions: false,
            showComments: false,
          },
        });
      } else {
        const { default: MessageContent } =
          await import('/src/lib/components/chat/MessageContent.svelte');
        mount(MessageContent, {
          target: host,
          props: { content: [{ type: 'text', text: content }] },
        });
      }
    },
    { code, hostKind },
  );
}

async function geometry(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('.mermaid-renderer');
  await expect(root).toHaveAttribute('data-render-settled', 'true');
  await expect(root.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
  await root.evaluate(
    (root) =>
      new Promise<void>((resolve, reject) => {
        let previous = '';
        let stable = 0;
        const started = performance.now();
        const sample = () => {
          const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg');
          const signature = JSON.stringify([
            root.getBoundingClientRect(),
            svg?.getBoundingClientRect(),
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
            reject(new Error('Parallel lane geometry did not settle'));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  return root.evaluate((root) => {
    const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg')!;
    const viewport = root.querySelector<HTMLElement>('.mermaid-svg-viewport')!;
    const rect = (el: Element) =>
      el.getBoundingClientRect().toJSON() as {
        x: number;
        y: number;
        width: number;
        height: number;
        right: number;
        bottom: number;
      };
    const nodes = [...svg.querySelectorAll<SVGGElement>('g.node')].map((node) => {
      const label = node.querySelector<SVGGraphicsElement>('.label')!;
      const text = node.querySelector('.nodeLabel p')!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const matrix = label.getScreenCTM()!;
      return {
        id: node.id.match(/flowchart-(.+)-\d+$/)![1],
        box: rect(node.querySelector('.label-container')!),
        label: range.getBoundingClientRect().toJSON(),
        text: text.textContent,
        fontSize: parseFloat(getComputedStyle(text).fontSize) * Math.hypot(matrix.a, matrix.b),
      };
    });
    const edges = [...svg.querySelectorAll<SVGPathElement>('.edgePaths path')].map((path) => {
      const matrix = path.getScreenCTM()!;
      const length = path.getTotalLength();
      return {
        id: path.id.match(/-L_(.+)_\d+$/)![1],
        marker: path.getAttribute('marker-end'),
        points: Array.from({ length: 101 }, (_, i) => {
          const p = path.getPointAtLength((length * i) / 100).matrixTransform(matrix);
          return { x: p.x, y: p.y };
        }),
      };
    });
    return {
      nodes,
      edges,
      clusters: [...svg.querySelectorAll('g.cluster')].map((group) => ({
        id: group.id,
        box: rect(group.querySelector(':scope > rect')!),
        title: rect(group.querySelector('.cluster-label')!),
      })),
      renderer: rect(root),
      svg: rect(svg),
      viewport: rect(viewport),
      scrollWidth: viewport.scrollWidth,
      clientWidth: viewport.clientWidth,
      overflow: getComputedStyle(viewport).overflowX,
      compact: Boolean(svg.querySelector('[data-compact-grouped-route]')),
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

type Geometry = Awaited<ReturnType<typeof geometry>>;
function verifyMembership(g: Geometry, members: string[], names: string[], edges: string[]) {
  expect(g.nodes.map((node) => node.id).sort()).toEqual([...names].sort());
  expect(g.edges.map((edge) => edge.id).sort()).toEqual([...edges].sort());
  expect(g.clusters).toHaveLength(1);
  const { box, title } = g.clusters[0];
  expect(title.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(title.right).toBeLessThanOrEqual(box.right + 1);
  expect(title.y).toBeGreaterThanOrEqual(box.y - 1);
  expect(title.bottom).toBeLessThanOrEqual(box.bottom + 1);
  for (const node of g.nodes) {
    if (members.includes(node.id)) {
      expect(node.box.x, `${node.id} inside group left`).toBeGreaterThanOrEqual(box.x - 1);
      expect(node.box.right, `${node.id} inside group right`).toBeLessThanOrEqual(box.right + 1);
      expect(node.box.bottom, `${node.id} inside group bottom`).toBeLessThanOrEqual(box.bottom + 1);
      expect(node.box.y, `${node.id} below group title`).toBeGreaterThanOrEqual(title.bottom + 10);
    } else {
      expect(
        node.box.x < box.right &&
          node.box.right > box.x &&
          node.box.y < box.bottom &&
          node.box.bottom > box.y,
        `${node.id} must not intersect the group or its header`,
      ).toBe(false);
    }
    expect(node.fontSize).toBeGreaterThanOrEqual(11.9);
    expect(node.label.x).toBeGreaterThanOrEqual(node.box.x - 1);
    expect(node.label.right).toBeLessThanOrEqual(node.box.right + 1);
    expect(node.label.y).toBeGreaterThanOrEqual(node.box.y - 1);
    expect(node.label.bottom).toBeLessThanOrEqual(node.box.bottom + 1);
  }
  for (const edge of g.edges) expect(edge.marker).toBeTruthy();
  expect(g.pageOverflow).toBeLessThanOrEqual(1);
}

function verifyLanes(g: Geometry, names: string[], expectedLinks: string[]) {
  expect(g.nodes.map((n) => n.id).sort()).toEqual([...names].sort());
  expect(g.edges.map((e) => e.id).sort()).toEqual([...expectedLinks].sort());
  const nodes = names.map((id) => g.nodes.find((n) => n.id === id)!);
  const centerX = (n: (typeof nodes)[number]) => n.box.x + n.box.width / 2;
  const centerY = (n: (typeof nodes)[number]) => n.box.y + n.box.height / 2;
  for (const rank of [nodes.slice(0, 3), nodes.slice(3, 6), nodes.slice(6, 9)]) {
    expect(
      Math.max(...rank.map(centerY)) - Math.min(...rank.map(centerY)),
      'three aligned ranks',
    ).toBeLessThan(1);
    const ordered = rank.toSorted((a, b) => a.box.x - b.box.x);
    expect(ordered[1].box.x - ordered[0].box.right, 'separate columns').toBeGreaterThan(4);
    expect(ordered[2].box.x - ordered[1].box.right, 'separate columns').toBeGreaterThan(4);
  }
  for (let lane = 0; lane < 3; lane++) {
    const column = [nodes[lane], nodes[lane + 3], nodes[lane + 6]];
    expect(
      Math.max(...column.map(centerX)) - Math.min(...column.map(centerX)),
      'branch aligned under its tab',
    ).toBeLessThan(1);
    expect(column[1].box.y - column[0].box.bottom).toBeGreaterThan(4);
    expect(column[2].box.y - column[1].box.bottom).toBeGreaterThan(4);
  }
  expect(g.clusters).toHaveLength(1);
  const { box: group, title } = g.clusters[0];
  const contained = nodes.filter(
    (n) =>
      n.box.x >= group.x - 1 &&
      n.box.right <= group.right + 1 &&
      n.box.y >= group.y - 1 &&
      n.box.bottom <= group.bottom + 1,
  );
  expect(contained.map((n) => n.id).sort(), 'only the tabs belong to the group').toEqual(
    names.slice(0, 3).sort(),
  );
  expect(title.bottom + 10).toBeLessThanOrEqual(Math.min(...nodes.slice(0, 3).map((n) => n.box.y)));
  for (const node of nodes) {
    expect(node.fontSize).toBeGreaterThanOrEqual(11.9);
    expect(node.label.x).toBeGreaterThanOrEqual(node.box.x - 1);
    expect(node.label.right).toBeLessThanOrEqual(node.box.right + 1);
    expect(node.label.y).toBeGreaterThanOrEqual(node.box.y - 1);
    expect(node.label.bottom).toBeLessThanOrEqual(node.box.bottom + 1);
  }
  for (const edge of g.edges) {
    const [from, to] = edge.id.split('_').map((id) => nodes.find((n) => n.id === id)!);
    const first = edge.points[0];
    const last = edge.points.at(-1)!;
    expect(Math.abs(first.x - centerX(from))).toBeLessThan(1);
    expect(Math.abs(first.y - from.box.bottom)).toBeLessThan(1);
    expect(Math.abs(last.x - centerX(to))).toBeLessThan(1);
    expect(Math.abs(to.box.y - last.y - 5), 'existing 5px terminal gap').toBeLessThan(1.1);
    expect(edge.marker).toBeTruthy();
    for (const node of nodes.filter((n) => n !== from && n !== to)) {
      expect(
        edge.points.some(
          (p) =>
            p.x > node.box.x && p.x < node.box.right && p.y > node.box.y && p.y < node.box.bottom,
        ),
        'no unrelated node crossing',
      ).toBe(false);
    }
    expect(
      edge.points.some(
        (p) => p.x > title.x && p.x < title.right && p.y > title.y && p.y < title.bottom,
      ),
      'no header crossing',
    ).toBe(false);
  }
  expect(g.svg.height, 'three ranks instead of the reproduced 1418px nine-node stack').toBeLessThan(
    700,
  );
  expect(g.pageOverflow, 'diagram-only overflow').toBeLessThanOrEqual(1);
}

for (const scenario of [
  {
    name: 'supplied note reduced',
    code: source,
    names: ids,
    host: 'note' as const,
    motion: 'reduced' as const,
  },
  {
    name: 'supplied note full',
    code: source,
    names: ids,
    host: 'note' as const,
    motion: 'full' as const,
  },
  {
    name: 'renamed note reduced',
    code: renamedSource,
    names: renamedIds,
    host: 'note' as const,
    motion: 'reduced' as const,
  },
  {
    name: 'supplied chat reduced',
    code: source,
    names: ids,
    host: 'chat' as const,
    motion: 'reduced' as const,
  },
]) {
  test(`parallel lanes: ${scenario.name} through resize-back`, async ({ page }, info) => {
    await mountDiagram(page, scenario.code, scenario.host, scenario.motion);
    const widths = scenario.host === 'note' ? [1000, 420, 340, 1000] : [864, 360, 864];
    const expectedLinks = links.map((link) =>
      link
        .split('_')
        .map((id) => scenario.names[ids.indexOf(id)])
        .join('_'),
    );
    for (const [index, width] of widths.entries()) {
      await page.locator('#parallel-lanes-host').evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, width);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const g = await geometry(page);
      await writeFile(info.outputPath(`${index}-${width}.json`), JSON.stringify(g, null, 2));
      await page
        .locator('#parallel-lanes-host')
        .screenshot({ path: info.outputPath(`${index}-${width}.png`) });
      verifyLanes(g, scenario.names, expectedLinks);
      if (width <= 420) {
        // The 420px note needs only a short scroll; also exercise a smaller
        // note lane so a substantial scroll cannot pass as an inert viewport.
        if (width < 420) expect(g.scrollWidth - g.clientWidth).toBeGreaterThan(100);
        expect(g.svg.width - g.viewport.width).toBeGreaterThan(0);
        expect(Math.abs(g.scrollWidth - g.svg.width)).toBeLessThanOrEqual(1);
        expect(g.overflow).toBe('auto');
        const viewport = page.locator('.mermaid-svg-viewport');
        await viewport.hover();
        await page.mouse.wheel(g.scrollWidth, 0);
        await expect
          .poll(() => viewport.evaluate((el) => el.scrollLeft))
          .toBe(g.scrollWidth - g.clientWidth);
        const scrolled = await geometry(page);
        expect(scrolled.svg.right).toBeLessThanOrEqual(scrolled.viewport.right + 1);
        verifyLanes(scrolled, scenario.names, expectedLinks);
        await page.mouse.wheel(-g.scrollWidth, 0);
        await expect.poll(() => viewport.evaluate((el) => el.scrollLeft)).toBe(0);
      }
    }
    const sourceButton = page
      .locator('.mermaid-renderer')
      .getByRole('button', { name: 'View source', exact: true });
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(scenario.code);
  });
}

test('nested cluster headers preserve descendant membership through resize-back', async ({
  page,
}) => {
  await mountDiagram(page, nestedHeaderSource, 'note', 'reduced');
  const stages: Geometry[] = [];
  for (const width of [1000, 420, 1000]) {
    await page.locator('#parallel-lanes-host').evaluate((host, width) => {
      host.style.width = `${width}px`;
    }, width);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const g = await geometry(page);
    expect(g.clusters).toHaveLength(2);
    const cluster = (id: string) =>
      g.clusters.find((group) => group.id === id || group.id.endsWith(`-${id}`))!;
    const child = cluster('workers');
    const parent = cluster('environment');
    for (const [group, members] of [
      [child, ['B']],
      [parent, ['B', 'C']],
    ] as const) {
      verifyMembership(
        { ...g, clusters: [group] },
        [...members],
        ['A', 'B', 'C', 'D', 'E', 'F'],
        ['A_B', 'B_C', 'D_E', 'E_F'],
      );
    }
    expect(child.box.x).toBeGreaterThanOrEqual(parent.box.x - 1);
    expect(child.box.right).toBeLessThanOrEqual(parent.box.right + 1);
    expect(child.box.y).toBeGreaterThanOrEqual(parent.title.bottom + 10);
    expect(child.box.bottom).toBeLessThanOrEqual(parent.box.bottom + 1);
    stages.push(g);
  }
  expect(Math.abs(stages[0].svg.width - stages[2].svg.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(stages[0].svg.height - stages[2].svg.height)).toBeLessThanOrEqual(1);
});

for (const scenario of [
  {
    name: 'exact',
    code: mixedMembershipSource,
    members: ['A', 'B', 'E'],
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: ['A_B', 'B_C', 'D_E', 'E_F'],
  },
  {
    name: 'renamed and reordered',
    code: reorderedMembershipSource,
    members: ['start1', 'center1', 'center2'],
    names: ['start1', 'center1', 'finish1', 'start2', 'center2', 'finish2'],
    edges: ['start1_center1', 'center1_finish1', 'start2_center2', 'center2_finish2'],
  },
  {
    name: 'interleaved declarations',
    code: interleavedMembershipSource,
    members: ['A', 'B', 'E'],
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: ['A_B', 'B_C', 'D_E', 'E_F'],
  },
  {
    name: 'wrapped header',
    code: wrappedHeaderSource,
    members: ['B'],
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: ['A_B', 'B_C', 'D_E', 'E_F'],
  },
  {
    name: 'renamed wrapped header',
    code: wrappedHeaderSource
      .replace(/\b[A-F]\b/g, (id) => `renamed${id}`)
      .replace('workers', 'renamedGroup'),
    members: ['renamedB'],
    names: ['renamedA', 'renamedB', 'renamedC', 'renamedD', 'renamedE', 'renamedF'],
    edges: ['renamedA_renamedB', 'renamedB_renamedC', 'renamedD_renamedE', 'renamedE_renamedF'],
  },
  {
    name: 'wrapped header with two legitimate members',
    code: wrappedHeaderSource.replace('B[Left middle]', 'B[Left middle]\n    E[Right middle]'),
    members: ['B', 'E'],
    names: ['A', 'B', 'C', 'D', 'E', 'F'],
    edges: ['A_B', 'B_C', 'D_E', 'E_F'],
  },
  {
    name: 'walgit external CDN',
    code: walgitSource,
    members: ['Git', 'Web', 'LFS', 'Bundle'],
    names: ['Git', 'Web', 'LFS', 'Bundle', 'Dev', 'Bucket', 'CDN'],
    edges: ['Dev_Machine', 'Machine_Bucket', 'CDN_Bucket'],
  },
  {
    name: 'renamed reordered walgit external CDN',
    code: reorderedWalgitSource,
    members: ['Http', 'Browser', 'LargeFiles', 'Archive'],
    names: ['Http', 'Browser', 'LargeFiles', 'Archive', 'User', 'Storage', 'Static'],
    edges: ['User_Runtime', 'Runtime_Storage', 'Static_Storage'],
  },
]) {
  test(`cluster membership: ${scenario.name} through resize-back`, async ({ page }, info) => {
    await mountDiagram(page, scenario.code, 'note', 'reduced');
    const stages: Geometry[] = [];
    for (const [index, width] of [1000, 420, 1000].entries()) {
      await page.locator('#parallel-lanes-host').evaluate((host, width) => {
        host.style.width = `${width}px`;
      }, width);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      const g = await geometry(page);
      await writeFile(info.outputPath(`${index}-${width}.json`), JSON.stringify(g, null, 2));
      await page
        .locator('#parallel-lanes-host')
        .screenshot({ path: info.outputPath(`${index}-${width}.png`) });
      verifyMembership(g, scenario.members, scenario.names, scenario.edges);
      if (width === 1000 && scenario.name.includes('wrapped header')) {
        expect(g.compact, 'wide header repair must not force compact routing').toBe(false);
        const title = g.clusters[0].title;
        for (const edge of g.edges) {
          expect(
            edge.points.some(
              (point) =>
                point.x > title.x &&
                point.x < title.right &&
                point.y > title.y &&
                point.y < title.bottom,
            ),
            `${edge.id} must clear the title`,
          ).toBe(false);
        }
      }
      stages.push(g);
    }
    expect(Math.abs(stages[0].svg.height - stages[2].svg.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(stages[0].svg.width - stages[2].svg.width)).toBeLessThanOrEqual(1);
    const sourceButton = page
      .locator('.mermaid-renderer')
      .getByRole('button', { name: 'View source', exact: true });
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(scenario.code);
  });
}
