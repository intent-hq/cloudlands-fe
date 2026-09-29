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

async function mountNote(
  page: Page,
  source: string,
  width: number,
  info: TestInfo,
  theme = 'light',
  localActors = false,
) {
  await page.setViewportSize({ width: 1280, height: 1200 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=${theme}&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible({ timeout: 60_000 });
  const path = 'src/lib/components/markdown/MermaidRenderer.svelte';
  const response = page.waitForResponse((r) => new URL(r.url()).pathname === `/${path}`);
  await page.evaluate(
    async ({ source, width, localActors }) => {
      const [{ mount }, { default: NoteWithComments }] = await Promise.all([
        import('/@id/svelte'),
        import('/src/lib/components/workspace/NoteWithComments.svelte'),
      ]);
      if (localActors) {
        // Keep Mermaid's real output, but express actor rows as group translations
        // instead of absolute child coordinates before the renderer fits it.
        const module = await (
          await fetch('/src/lib/components/markdown/MermaidRenderer.svelte')
        ).text();
        const url = module.match(/import mermaid from "([^"]+)"/)![1];
        const { default: mermaid } = await import(url);
        const render = mermaid.render.bind(mermaid);
        mermaid.render = async (...args: Parameters<typeof render>) => {
          const result = await render(...args);
          const document = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
          for (const actor of document.querySelectorAll('g.actor-man')) {
            const y = Number(actor.querySelector('circle')!.getAttribute('cy')) - 10;
            actor.setAttribute('transform', `translate(0, ${y})`);
            for (const child of actor.querySelectorAll('*')) {
              for (const attribute of ['y', 'cy', 'y1', 'y2']) {
                if (child.hasAttribute(attribute))
                  child.setAttribute(attribute, String(Number(child.getAttribute(attribute)) - y));
              }
            }
          }
          return {
            ...result,
            svg: new XMLSerializer().serializeToString(document.documentElement),
          };
        };
      }
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
    { source, width, localActors },
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

// Compare real Chromium paint with construct surfaces hidden. Every opaque note
// interior (including its text) must paint identically with and without surfaces.
// A second capture with text hidden proves that each authored line paints glyphs.
async function notePaint(page: Page) {
  await settled(page);
  const regions = await page.locator('.sequence-note').evaluateAll((groups) =>
    groups.flatMap((group) => {
      const box = group.querySelector('rect.note')!.getBoundingClientRect();
      const rect = (r: DOMRect, inset = 0) => ({
        x: Math.ceil(r.x + inset),
        y: Math.ceil(r.y + inset),
        width: Math.floor(r.width - inset * 2 - 1),
        height: Math.floor(r.height - inset * 2 - 1),
      });
      return [
        { name: 'pill', clip: rect(box, 7) },
        ...[...group.querySelectorAll('text')].map((text) => ({
          name: text.textContent!,
          clip: rect(text.getBoundingClientRect()),
        })),
      ];
    }),
  );
  const capture = async () => {
    const images = [];
    for (const { clip } of regions)
      images.push((await page.screenshot({ clip })).toString('base64'));
    return images;
  };
  const constructLabels = await page
    .locator('.sequence-construct text, .mermaid-svg > svg > g:has(> rect.rect) > text')
    .evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.getBoundingClientRect();
        return {
          name: `${label.closest('.sequence-construct') ? 'construct' : 'background'}: ${label.textContent}`,
          clip: {
            x: Math.ceil(box.x),
            y: Math.ceil(box.y),
            width: Math.floor(box.width - 1),
            height: Math.floor(box.height - 1),
          },
        };
      }),
    );
  regions.push(...constructLabels);
  const painted = await capture();
  const surfaceStyle = await page.addStyleTag({
    content: '.sequence-branch-surface { visibility: hidden !important; }',
  });
  const uncovered = await capture();
  await surfaceStyle.evaluate((style) => style.remove());
  const textStyle = await page.addStyleTag({
    content:
      '.sequence-note text, .sequence-construct text, .mermaid-svg > svg > g:has(> rect.rect) > text { visibility: hidden !important; }',
  });
  const withoutText = await capture();
  await textStyle.evaluate((style) => style.remove());
  return page.evaluate(
    async ({ regions, painted, uncovered, withoutText }) => {
      const pixels = async (png: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${png}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 4)
          if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
        return count;
      };
      return Promise.all(
        regions.map(async (region, i) => {
          const normal = await pixels(painted[i]);
          return {
            ...region,
            occludedPixels: difference(normal, await pixels(uncovered[i])),
            textPixels: difference(normal, await pixels(withoutText[i])),
          };
        }),
      );
    },
    { regions, painted, uncovered, withoutText },
  );
}

const paintCases = [
  { name: 'exact nested alt/loop light', source: constructSource, theme: 'light', frames: 2 },
  { name: 'exact nested alt/loop dark', source: constructSource, theme: 'dark', frames: 2 },
  {
    name: 'alt-only reduction',
    theme: 'light',
    frames: 1,
    source:
      'sequenceDiagram\nparticipant A\nparticipant B\nalt Ready\nA->>B: Begin\nNote over A: Visible note\nelse Retry\nB-->>A: Pending\nend',
  },
  {
    name: 'loop-only reduction',
    theme: 'light',
    frames: 1,
    source:
      'sequenceDiagram\nparticipant A\nparticipant B\nloop Until ready\nA->>B: Begin\nNote over A: Visible note\nend',
  },
];
for (const { name, source, theme, frames } of paintCases) {
  test(`construct surfaces do not occlude notes: ${name}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await mountNote(page, source, 1000, info, theme);
    await settled(page);
    await page
      .locator('#sequence-clearance-host')
      .screenshot({ path: info.outputPath('note.png') });
    await writeFile(
      info.outputPath('rendered.svg'),
      await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
    );
    const paint = await notePaint(page);
    await writeFile(info.outputPath('paint.json'), JSON.stringify(paint, null, 2));
    await expect(page.locator('.sequence-construct')).toHaveCount(frames);
    expect(
      paint
        .filter((region) => region.name !== 'pill' && !region.name.startsWith('construct:'))
        .map((region) => region.name),
    ).toEqual(frames === 2 ? ['First line', 'Second line', 'Try later'] : ['Visible note']);
    for (const region of paint) {
      expect
        .soft(region.occludedPixels, `${region.name} must not be covered by a construct surface`)
        .toBe(0);
      expect
        .soft(region.textPixels, `${region.name} must contain painted note text`)
        .toBeGreaterThan(20);
    }
    const sourceButton = page.getByRole('button', { name: /source/i }).first();
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(source);
  });
}

// Hide only the frame strokes so other painted content cannot satisfy this oracle.
async function framePaint(page: Page) {
  const svg = page.locator('.mermaid-svg > svg');
  const painted = (await svg.screenshot()).toString('base64');
  const results = [];
  for (const frame of await page.locator('.sequence-construct').all()) {
    await frame.locator('.sequence-frame-line').evaluateAll((lines) => {
      for (const line of lines) (line as SVGElement).style.visibility = 'hidden';
    });
    const hidden = (await svg.screenshot()).toString('base64');
    await frame.locator('.sequence-frame-line').evaluateAll((lines) => {
      for (const line of lines) (line as SVGElement).style.removeProperty('visibility');
    });
    results.push(
      await page.evaluate(
        async ({ painted, hidden }) => {
          const pixels = async (png: string) => {
            const image = new Image();
            image.src = `data:image/png;base64,${png}`;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          };
          const a = await pixels(painted),
            b = await pixels(hidden);
          let count = 0;
          for (let i = 0; i < a.length; i += 4)
            if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) count++;
          return count;
        },
        { painted, hidden },
      ),
    );
  }
  return results;
}

const backgroundCases = [
  {
    name: 'authored background enclosing alt',
    fills: ['rgb(230, 240, 255)'],
    frames: 1,
    source: `sequenceDiagram
participant A
participant B
rect rgb(230, 240, 255)
alt Ready
A->>B: Begin
Note over A: Visible note
else Retry
B-->>A: Pending
end
end`,
  },
  {
    name: 'nested and separate authored backgrounds',
    // Mermaid lowers each completed background: the later sibling precedes the
    // outer background, which precedes its inner background. Keep that order.
    fills: ['rgb(230, 255, 230)', 'rgb(230, 240, 255)', 'rgb(255, 240, 230)'],
    frames: 3,
    source: `sequenceDiagram
participant A
participant B
rect rgb(230, 240, 255)
alt Ready
rect rgb(255, 240, 230)
loop Until ready
A->>B: Begin
Note over A: Visible note
end
end
else Retry
B-->>A: Pending
end
end
rect rgb(230, 255, 230)
opt Later
A->>B: Finish
Note over B: Second note
end
end`,
  },
  {
    name: 'participant box background',
    fills: ['rgb(230, 240, 255)'],
    headings: ['Group'],
    frames: 1,
    source: `sequenceDiagram
box rgb(230, 240, 255) Group
participant A
participant B
end
alt Ready
A->>B: Begin
Note over A: Visible note
else Retry
B-->>A: Pending
end`,
  },
  {
    name: 'participant boxes with nested authored backgrounds',
    // Mermaid lowers participant boxes after rect blocks, in reverse declaration
    // order. Keep each heading with its box, above the corresponding rectangle.
    fills: ['rgb(230, 255, 230)', 'rgb(230, 240, 255)', 'rgb(255, 240, 230)', 'rgb(245, 235, 255)'],
    headings: ['Services', 'Workers'],
    frames: 2,
    source: `sequenceDiagram
box rgb(230, 240, 255) Workers
participant A
end
box rgb(230, 255, 230) Services
participant B
end
rect rgb(255, 240, 230)
alt Ready
rect rgb(245, 235, 255)
loop Until ready
A->>B: Begin
Note over A: Visible note
end
end
else Retry
B-->>A: Pending
end
end`,
  },
];
for (const { name, source, fills, frames, headings = [] } of backgroundCases) {
  test(`native backgrounds preserve construct paint: ${name}`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await mountNote(page, source, 1000, info);
    await settled(page);
    await page
      .locator('#sequence-clearance-host')
      .screenshot({ path: info.outputPath('note.png') });
    await writeFile(
      info.outputPath('rendered.svg'),
      await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
    );
    const paint = await notePaint(page);
    const framePixels = await framePaint(page);
    const layers = await page.locator('.mermaid-svg > svg').evaluate((svg) => {
      const children = [...svg.children];
      return {
        backgrounds: [...svg.querySelectorAll(':scope > rect.rect, :scope > g > rect.rect')].map(
          (e) => {
            const layer = e.parentElement === svg ? e : e.parentElement!;
            return {
              fill: e.getAttribute('fill'),
              index: children.indexOf(layer),
              heading: layer === e ? null : layer.querySelector('text')?.textContent,
              headingAfterRect:
                layer === e ||
                !!(
                  e.compareDocumentPosition(layer.querySelector('text')!) &
                  Node.DOCUMENT_POSITION_FOLLOWING
                ),
            };
          },
        ),
        constructs: [
          ...svg.querySelectorAll<SVGGraphicsElement>(':scope > .sequence-construct'),
        ].map((e) => {
          const { x, y, width, height } = e.getBBox();
          return { index: children.indexOf(e), box: { x, y, width, height } };
        }),
        foreground: [
          ...svg.querySelectorAll(
            ':scope > .sequence-note, :scope > .messageText, :scope > .messageLine0, :scope > .messageLine1',
          ),
        ].map((e) => children.indexOf(e)),
      };
    });
    await writeFile(
      info.outputPath('background-paint.json'),
      JSON.stringify({ paint, framePixels, layers }, null, 2),
    );
    expect.soft(layers.backgrounds.map((b) => b.fill)).toEqual(fills);
    expect(layers.backgrounds.flatMap((b) => (b.heading ? [b.heading] : []))).toEqual(headings);
    expect(layers.backgrounds.every((b) => b.headingAfterRect)).toBe(true);
    expect(layers.constructs).toHaveLength(frames);
    for (const region of paint) {
      expect.soft(region.occludedPixels, `${region.name} stays above surfaces`).toBe(0);
      expect.soft(region.textPixels, `${region.name} paints visible glyphs`).toBeGreaterThan(20);
    }
    for (const pixels of framePixels)
      expect.soft(pixels, 'frame strokes paint').toBeGreaterThan(20);
    expect
      .soft(Math.max(...layers.backgrounds.map((b) => b.index)))
      .toBeLessThan(Math.min(...layers.constructs.map((c) => c.index)));
    expect
      .soft(Math.max(...layers.constructs.map((c) => c.index)))
      .toBeLessThan(Math.min(...layers.foreground));
    for (const outer of layers.constructs)
      for (const inner of layers.constructs) {
        if (outer === inner) continue;
        const a = outer.box,
          b = inner.box;
        if (
          a.x <= b.x &&
          a.y <= b.y &&
          a.x + a.width >= b.x + b.width &&
          a.y + a.height >= b.y + b.height
        )
          expect(outer.index, 'outer construct paints before enclosed construct').toBeLessThan(
            inner.index,
          );
      }
    const sourceButton = page.getByRole('button', { name: /source/i }).first();
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(source);
  });
}

test('note paint oracle detects a surface moved over authored content', async ({ page }, info) => {
  test.setTimeout(120_000);
  await mountNote(page, constructSource, 1000, info);
  await settled(page);
  await page.locator('.mermaid-svg > svg').evaluate((svg) => {
    svg.append(...svg.querySelectorAll(':scope > .sequence-construct'));
  });
  const paint = await notePaint(page);
  const notes = paint.filter((region) => !region.name.startsWith('construct:'));
  expect(notes).toHaveLength(5);
  expect(notes.every((region) => region.occludedPixels > 20 && region.textPixels === 0)).toBe(true);
  await writeFile(info.outputPath('paint-control.json'), JSON.stringify(paint, null, 2));
});

async function actorGeometry(page: Page) {
  await settled(page);
  return page.locator('.mermaid-svg > svg').evaluate((svg: SVGSVGElement) => {
    const rect = (element: Element) => element.getBoundingClientRect().toJSON();
    const actors = [...svg.querySelectorAll('g.actor-man')].map((actor) => ({
      bottom: actor.classList.contains('actor-bottom'),
      icon: rect(actor.querySelector('.mermaid-actor-user-icon')!),
      label: rect(actor.querySelector('text')!),
      localIcon: actor.querySelector('.mermaid-actor-user-icon')!.getAttribute('y'),
      localLabel: actor.querySelector('text')!.getAttribute('y'),
    }));
    return {
      actors,
      worker: [...svg.querySelectorAll('rect.actor')].map(rect),
      lifeline: rect(svg.querySelector('.actor-line[name="Visitor"]')!),
    };
  });
}

function expectActorsAligned(result: Awaited<ReturnType<typeof actorGeometry>>, mirrored: boolean) {
  expect(result.actors).toHaveLength(mirrored ? 2 : 1);
  const top = result.actors.find((actor) => !actor.bottom)!;
  const topWorker = result.worker.reduce((a, b) => (a.top < b.top ? a : b));
  for (const actor of result.actors) {
    expect(actor.icon.x + actor.icon.width / 2).toBeCloseTo(result.lifeline.x, 2);
    expect(actor.label.x + actor.label.width / 2).toBeCloseTo(result.lifeline.x, 2);
    expect(actor.icon.bottom).toBeLessThanOrEqual(actor.label.top);
  }
  if (!mirrored) return;
  const bottom = result.actors.find((actor) => actor.bottom)!;
  const bottomWorker = result.worker.reduce((a, b) => (a.top > b.top ? a : b));
  expect(bottom.icon.top).toBeGreaterThanOrEqual(bottomWorker.top);
  expect(bottom.label.bottom).toBeLessThanOrEqual(bottomWorker.bottom);
  expect(bottom.icon.top - bottomWorker.top).toBeCloseTo(top.icon.top - topWorker.top, 2);
  expect(bottom.label.top - bottomWorker.top).toBeCloseTo(top.label.top - topWorker.top, 2);
  expect(bottomWorker.top).toBeCloseTo(result.lifeline.bottom, 2);
}

for (const mirrored of [true, false]) {
  test(`mirrored actor row and repeat renders: mirrorActors=${mirrored}`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    const source = constructSource.replace('mirrorActors: true', `mirrorActors: ${mirrored}`);
    await mountNote(page, source, 1000, info);
    const before = await actorGeometry(page);
    await writeFile(info.outputPath('actor-before.json'), JSON.stringify(before, null, 2));
    await writeFile(
      info.outputPath('rendered.svg'),
      await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
    );
    await page
      .locator('#sequence-clearance-host')
      .screenshot({ path: info.outputPath('note.png') });
    expectActorsAligned(before, mirrored);
    // A scaled/translated ancestor must not mix screen and SVG-local coordinates.
    await page.locator('#sequence-clearance-host').evaluate((host) => {
      host.style.transformOrigin = 'top left';
      host.style.transform = 'translate(17px, 23px) scale(0.8)';
    });
    expectActorsAligned(await actorGeometry(page), mirrored);
    await page.locator('#sequence-clearance-host').evaluate((host) => {
      host.style.transform = '';
    });
    for (const theme of ['dark', 'light', 'dark', 'light']) {
      const generation = await page
        .locator('.mermaid-renderer')
        .getAttribute('data-render-generation');
      await page.evaluate((theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        document.documentElement.setAttribute('data-theme', theme);
      }, theme);
      await expect(page.locator('.mermaid-renderer')).not.toHaveAttribute(
        'data-render-generation',
        generation!,
      );
      expectActorsAligned(await actorGeometry(page), mirrored);
    }
    const after = await actorGeometry(page);
    expectActorsAligned(after, mirrored);
    expect(after).toEqual(before);
    await writeFile(info.outputPath('actor-after.json'), JSON.stringify(after, null, 2));
    const sourceButton = page.getByRole('button', { name: /source/i }).first();
    await sourceButton.focus();
    await sourceButton.press('Enter');
    expect(await page.locator('.mermaid-source pre').textContent()).toBe(source);
  });
}

test('mirrored actor row with translated SVG groups', async ({ page }, info) => {
  await mountNote(page, constructSource, 1000, info, 'light', true);
  const result = await actorGeometry(page);
  await writeFile(info.outputPath('actor-geometry.json'), JSON.stringify(result, null, 2));
  await writeFile(
    info.outputPath('rendered.svg'),
    await page.locator('.mermaid-svg > svg').evaluate((e) => e.outerHTML),
  );
  await page.locator('#sequence-clearance-host').screenshot({ path: info.outputPath('note.png') });
  expectActorsAligned(result, true);
});
