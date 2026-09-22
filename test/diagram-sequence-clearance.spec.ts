import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');
const exactSource = `sequenceDiagram
participant App
participant Daemon as Remote intentd
App->>Daemon: Start agent task
Daemon-->>App: Task started
Note over App: Laptop sleeps
Note over Daemon: Agent continues
Note over App: Laptop wakes
App->>Daemon: Reconnect and request missed updates
Daemon-->>App: Current state and new output
Note over App: Workspace restored`;

const constructSource = `---
config:
  sequence:
    mirrorActors: true
---
sequenceDiagram
autonumber
actor Visitor
participant Worker
Visitor->>Worker: Begin
activate Worker
alt Ready
Worker-->>Visitor: Accepted
Note over Visitor: First line<br/>Second line
Worker->>Worker: Save
else Retry
loop Until ready
Visitor->>Worker: Retry
Worker-->>Visitor: Pending
Note over Visitor: Try later
end
end
deactivate Worker
Visitor->>Worker: Finish`;

async function mountNote(page: Page, source: string, width: number, info: TestInfo) {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=light&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible();
  const path = 'src/lib/components/markdown/MermaidRenderer.svelte';
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === `/${path}`);
  await page.evaluate(
    async ({ source, width }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      const host = document.createElement('div');
      host.id = 'sequence-clearance-host';
      host.style.cssText = `width:${width}px;min-height:1000px;margin:0 auto`;
      document.body.replaceChildren(host);
      mount(NoteWithComments, {
        target: host,
        props: {
          workspace: {
            id: 'synthetic-sequence-clearance',
            title: 'Synthetic sequence clearance',
            branch: 'test',
            changesets: [],
            timeline: [],
            conversationInfo: [],
            status: 'Active',
            createdAt: '2026-09-14T00:00:00.000Z',
            updatedAt: '2026-09-14T00:00:00.000Z',
          },
          content: `~~~mermaid\n${source}\n~~~`,
          editable: false,
          showSuggestions: false,
          showComments: false,
        },
      });
    },
    { source, width },
  );
  const served = await (await response).text();
  const map = served.match(/sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/);
  expect(map).not.toBeNull();
  const disk = await readFile(path, 'utf8');
  expect(JSON.parse(Buffer.from(map![1], 'base64').toString()).sourcesContent).toContain(disk);
  await writeFile(
    info.outputPath('source-identity.json'),
    JSON.stringify(
      {
        source,
        sha256: createHash('sha256').update(disk).digest('hex'),
      },
      null,
      2,
    ),
  );
}

async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  const root = page.locator('#sequence-clearance-host .mermaid-renderer');
  await expect(root).toHaveAttribute('data-render-settled', 'true');
  await root.evaluate(
    (root) =>
      new Promise<void>((resolve, reject) => {
        let previous = '',
          stable = 0;
        const start = performance.now();
        const sample = () => {
          const svg = root.querySelector<SVGSVGElement>('.mermaid-svg > svg');
          const signature = JSON.stringify([
            root.getBoundingClientRect(),
            svg?.getBoundingClientRect(),
            svg?.getAttribute('viewBox'),
            root.getAttribute('data-render-generation'),
            [...(svg?.querySelectorAll('.note, .messageLine0, .messageLine1') ?? [])].map((e) =>
              e.getBoundingClientRect(),
            ),
          ]);
          stable =
            signature === previous &&
            root.getAttribute('data-render-settled') === 'true' &&
            svg?.dataset.layoutSettled === 'true'
              ? stable + 1
              : 0;
          previous = signature;
          if (stable >= 8) resolve();
          else if (performance.now() - start > 10000) reject(new Error('Sequence did not settle'));
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
  );
  return root;
}

async function measure(page: Page) {
  const root = await settled(page);
  return root.locator('.mermaid-svg > svg').evaluate(async (svg: SVGSVGElement) => {
    const viewBox = svg.viewBox.baseVal;
    const screen = svg.getScreenCTM()!;
    const rect = (e: Element) => e.getBoundingClientRect().toJSON();
    // Independent painted-pixel oracle. Rasterize only the actual line/marker,
    // resolving live styles, without changing the live SVG or its geometry.
    const paintBottom = async (line: SVGLineElement, marker: boolean) => {
      const clone = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      clone.setAttribute('viewBox', svg.getAttribute('viewBox')!);
      clone.setAttribute('width', String(viewBox.width));
      clone.setAttribute('height', String(viewBox.height));
      const definitions = document.createElementNS(clone.namespaceURI, 'defs');
      for (const original of svg.querySelectorAll('marker')) {
        const copy = original.cloneNode(true) as SVGElement;
        const originals = [original, ...original.querySelectorAll('*')];
        [copy, ...copy.querySelectorAll('*')].forEach((element, i) => {
          const style = getComputedStyle(originals[i]);
          for (const p of ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'])
            (element as SVGElement).style.setProperty(p, style.getPropertyValue(p));
        });
        definitions.append(copy);
      }
      clone.append(definitions);
      const copy = line.cloneNode(true) as SVGLineElement;
      const style = getComputedStyle(line);
      for (const p of [
        'fill',
        'stroke',
        'stroke-width',
        'stroke-linecap',
        'stroke-linejoin',
        'stroke-dasharray',
      ])
        copy.style.setProperty(p, style.getPropertyValue(p));
      if (!marker) {
        copy.removeAttribute('marker-end');
        copy.removeAttribute('marker-start');
      }
      clone.append(copy);
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      const scale = 4;
      canvas.width = Math.ceil(viewBox.width * scale);
      canvas.height = Math.ceil(viewBox.height * scale);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let y = canvas.height - 1; y >= 0; y--)
        for (let x = 0; x < canvas.width; x++)
          if (pixels[(y * canvas.width + x) * 4 + 3] > 16)
            return viewBox.y + ((y + 1) * viewBox.height) / canvas.height;
      throw new Error('No painted arrow pixels');
    };
    const arrows = [
      ...svg.querySelectorAll<SVGLineElement>(
        ':scope > line.messageLine0, :scope > line.messageLine1',
      ),
    ];
    const notes = [...svg.querySelectorAll<SVGRectElement>('.sequence-note > rect.note')];
    const pairs = [];
    for (const arrow of arrows) {
      const arrowY = arrow.y1.baseVal.value;
      const next = notes.find((note) => note.y.baseVal.value > arrowY);
      if (
        !next ||
        arrows.some(
          (other) =>
            other.y1.baseVal.value > arrowY && other.y1.baseVal.value < next.y.baseVal.value,
        )
      )
        continue;
      const strokeBottom = await paintBottom(arrow, false);
      const markerBottom = await paintBottom(arrow, true);
      const noteTop = next.getBBox().y;
      pairs.push({
        direction: Math.sign(arrow.x2.baseVal.value - arrow.x1.baseVal.value),
        arrow: arrow.outerHTML,
        noteText: next.parentElement?.textContent,
        strokeBottom,
        markerBottom,
        noteTop,
        gap: noteTop - markerBottom,
        strokeBottomScreen: new DOMPoint(0, strokeBottom).matrixTransform(screen).y,
        markerBottomScreen: new DOMPoint(0, markerBottom).matrixTransform(screen).y,
        noteTopScreen: next.getBoundingClientRect().top,
        gapScreen: (noteTop - markerBottom) * screen.d,
      });
    }
    return {
      pairs,
      viewBox: { x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height },
      screen: { a: screen.a, d: screen.d },
      svg: rect(svg),
      arrows: arrows.map((e) => ({ y: e.y1.baseVal.value, box: rect(e) })),
      notes: notes.map((e) => ({
        box: rect(e),
        local: {
          x: e.x.baseVal.value,
          y: e.y.baseVal.value,
          width: e.width.baseVal.value,
          height: e.height.baseVal.value,
        },
      })),
      markers: [...svg.querySelectorAll('marker')].map((e) => e.outerHTML),
      renderer: rect(svg.closest('.mermaid-renderer')!),
      noteInsets: notes.map((note) => {
        const box = note.getBoundingClientRect();
        const texts = [...note.parentElement!.querySelectorAll('text')].map((e) =>
          e.getBoundingClientRect(),
        );
        return [
          Math.min(...texts.map((e) => e.left)) - box.left,
          box.right - Math.max(...texts.map((e) => e.right)),
          Math.min(...texts.map((e) => e.top)) - box.top,
          box.bottom - Math.max(...texts.map((e) => e.bottom)),
        ];
      }),
      structure: [
        ...svg.querySelectorAll<SVGGraphicsElement>(
          '.actor-line, .actor-top, .actor-bottom, .sequence-construct, path.messageLine0, path.messageLine1',
        ),
      ].map((e) => ({ markup: e.outerHTML, box: rect(e) })),
      texts: [...svg.querySelectorAll<SVGTextElement>('text')].map((e) => ({
        text: e.textContent,
        box: rect(e),
        size: parseFloat(getComputedStyle(e).fontSize) * screen.d,
      })),
    };
  });
}

type Measurement = Awaited<ReturnType<typeof measure>>;
function expectClearance(result: Measurement) {
  expect(result.pairs).toHaveLength(2);
  for (const pair of result.pairs) {
    expect(pair.markerBottom).toBeGreaterThan(pair.strokeBottom + 1);
    expect(pair.gap).toBeGreaterThanOrEqual(11.75);
    expect(pair.gap).toBeLessThanOrEqual(13);
    expect(pair.noteTopScreen - pair.markerBottomScreen).toBeCloseTo(pair.gapScreen, 2);
    expect(pair.noteTopScreen - pair.markerBottomScreen).toBeGreaterThanOrEqual(11.75);
  }
  expect(result.noteInsets.every((insets) => insets.every((gap) => gap >= 5.5))).toBe(true);
  expect(result.texts.every((text) => text.size >= 11.9)).toBe(true);
}

async function resizeNote(page: Page, width: number) {
  await page.locator('#sequence-clearance-host').evaluate((host, width) => {
    host.style.width = `${width}px`;
  }, width);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

for (const width of [360, 1000]) {
  test(`exact replies clear following notes at ${width}px`, async ({ page }, info) => {
    await mountNote(page, exactSource, width, info);
    const result = await measure(page);
    await writeFile(info.outputPath('geometry.json'), JSON.stringify(result, null, 2));
    await writeFile(
      info.outputPath('rendered.svg'),
      await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
    );
    await page
      .locator('#sequence-clearance-host')
      .screenshot({ path: info.outputPath('note.png') });
    expectClearance(result);
    expect(result.pairs.every((pair) => pair.direction === -1)).toBe(true);
    const samples = [result];
    for (const nextWidth of [width === 360 ? 1000 : 360, width]) {
      await resizeNote(page, nextWidth);
      const next = await measure(page);
      expectClearance(next);
      expect(next.renderer.width).toBeLessThan(nextWidth);
      if (nextWidth === 1000) expect(next.renderer.width).toBeGreaterThan(620);
      else expect(next.renderer.width).toBeLessThan(360);
      samples.push(next);
    }
    const repeated = samples.at(-1)!;
    expect(repeated.viewBox).toEqual(result.viewBox);
    expect(repeated.notes).toEqual(result.notes);
    expect(repeated.arrows).toEqual(result.arrows);
    expect(repeated.texts).toEqual(result.texts);
    await writeFile(info.outputPath('resize-back.json'), JSON.stringify(samples, null, 2));
    const sourceButton = page.getByRole('button', { name: /source/i }).first();
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(exactSource);
    await sourceButton.press('Enter');
  });
}

test('rightward reply control', async ({ page }, info) => {
  await mountNote(
    page,
    exactSource.replace(
      'participant App\nparticipant Daemon as Remote intentd',
      'participant Daemon as Remote intentd\nparticipant App',
    ),
    360,
    info,
  );
  const result = await measure(page);
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(result, null, 2));
  await page.locator('#sequence-clearance-host').screenshot({ path: info.outputPath('note.png') });
  expectClearance(result);
  expect(result.pairs.every((pair) => pair.direction === 1)).toBe(true);
});

test('wrapped notes and sequence constructs', async ({ page }, info) => {
  await mountNote(page, constructSource, 1000, info);
  const result = await measure(page);
  await writeFile(info.outputPath('geometry.json'), JSON.stringify(result, null, 2));
  await writeFile(
    info.outputPath('rendered.svg'),
    await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
  );
  await page.locator('#sequence-clearance-host').screenshot({ path: info.outputPath('note.png') });
  expect(result.pairs).toHaveLength(2);
  for (const pair of result.pairs) expect(pair.gap).toBeGreaterThanOrEqual(11.75);
  const structure = await page.locator('.mermaid-svg > svg').evaluate((svg) => {
    const frames = [...svg.querySelectorAll('.sequence-construct')].map((group) => {
      const lines = [...group.querySelectorAll('.sequence-frame-line')].map((e) =>
        e.getBoundingClientRect(),
      );
      const tab = group.querySelector('.labelBox')!.getBoundingClientRect();
      return {
        top: Math.min(...lines.map((e) => e.top)),
        tabTop: tab.top,
        bottom: Math.max(...lines.map((e) => e.bottom)),
        surfaces: [...group.querySelectorAll('.sequence-branch-surface')].map((e) =>
          e.getBoundingClientRect().toJSON(),
        ),
      };
    });
    const self = svg.querySelector<SVGPathElement>('path.messageLine0')!;
    const point = self.getPointAtLength(0).matrixTransform(self.getScreenCTM()!);
    const numbers = [...svg.querySelectorAll<SVGTextElement>('.sequenceNumber')];
    const numberPoint = new DOMPoint(0, numbers[2].y.baseVal[0].value).matrixTransform(
      numbers[2].getScreenCTM()!,
    );
    const workerBottom = svg.querySelector('rect.actor-bottom')!.getBoundingClientRect().top;
    const lifelineBottom = Math.max(
      ...[...svg.querySelectorAll('.actor-line')].map((e) => e.getBoundingClientRect().bottom),
    );
    return { frames, selfNumberGap: numberPoint.y - point.y, workerBottom, lifelineBottom };
  });
  await writeFile(info.outputPath('construct-coherence.json'), JSON.stringify(structure, null, 2));
  expect(structure.frames).toHaveLength(2);
  for (const frame of structure.frames) {
    expect(frame.tabTop).toBeCloseTo(frame.top, 2);
    expect(
      frame.surfaces.every((s) => s.top >= frame.top + 3.9 && s.bottom <= frame.bottom - 3.9),
    ).toBe(true);
  }
  expect(structure.selfNumberGap).toBeCloseTo(4, 2);
  expect(structure.workerBottom).toBeCloseTo(structure.lifelineBottom, 2);
  expect(result.noteInsets.every((insets) => insets.every((gap) => gap >= 5.5))).toBe(true);
  expect(result.notes[0].local.height).toBeGreaterThan(32);
});

test('wrapped note retains visible insets and repeat-fit sizing', async ({ page }, info) => {
  const source = exactSource.replace('Laptop sleeps', 'Laptop sleeps<br/>Connection paused');
  await mountNote(page, source, 360, info);
  const before = await measure(page);
  expectClearance(before);
  expect(before.notes[0].local.height).toBeGreaterThan(32);
  await resizeNote(page, 1000);
  expectClearance(await measure(page));
  await resizeNote(page, 360);
  const after = await measure(page);
  expectClearance(after);
  expect(after.notes).toEqual(before.notes);
  expect(after.viewBox).toEqual(before.viewBox);
  await writeFile(info.outputPath('geometry.json'), JSON.stringify({ before, after }, null, 2));
  await page.locator('#sequence-clearance-host').screenshot({ path: info.outputPath('note.png') });
});

test('pixel clearance oracle rejects a note moved into the painted reply', async ({
  page,
}, info) => {
  await mountNote(page, exactSource, 360, info);
  const before = await measure(page);
  expectClearance(before);
  await page
    .locator('.sequence-note')
    .first()
    .evaluate((group) => group.setAttribute('transform', 'translate(0,-12)'));
  const after = await measure(page);
  expect(after.pairs[0].noteTopScreen - after.pairs[0].markerBottomScreen).toBeLessThan(1);
  expect(() => expectClearance(after)).toThrow();
});
