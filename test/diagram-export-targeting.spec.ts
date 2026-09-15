import { expect, test, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { CUSTOM_WORKBENCH_CASES } from '../src/lib/components/diagrams/diagram-workbench.preview-fixtures';

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the existing preview server.');

async function mountNote(page: Page, extraBlock = '') {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/sandbox/button?state=default&theme=light&motion=reduced`);
  await expect(page.locator('[data-preview-ready=true]')).toBeVisible();
  await page.evaluate(async (extraBlock) => {
    const [{ mount }, { default: NoteWithComments }, { default: Toaster }] = await Promise.all([
      import('/@id/svelte'),
      import('/src/lib/components/workspace/NoteWithComments.svelte'),
      import('/src/lib/components/ui/toast/Toast.svelte'),
    ]);
    const host = document.createElement('div');
    host.style.cssText = 'width:1000px;height:880px;margin:0 auto';
    document.body.replaceChildren(host);
    mount(Toaster, { target: host });
    mount(NoteWithComments, {
      target: host,
      props: {
        workspace: {
          id: 'synthetic-export-test',
          title: 'Synthetic export test',
          branch: 'test',
          changesets: [],
          timeline: [],
          conversationInfo: [],
          status: 'Active',
          createdAt: '2026-09-14T00:00:00.000Z',
          updatedAt: '2026-09-14T00:00:00.000Z',
        },
        content:
          '## Synthetic diagram exports\n\n~~~mermaid\ngraph LR\n A[Amber request] -->|validates| B[Amber result]\n~~~\n\n~~~mermaid\nsequenceDiagram\n participant C as Cobalt client\n participant S as Cobalt server\n C->>S: Cobalt request\n S-->>C: Cobalt response\n~~~\n\n' +
          extraBlock,
        editable: false,
        showSuggestions: false,
        showComments: false,
      },
    });
  }, extraBlock);
  await page.evaluate(() => document.fonts.ready);
  const lanes = page.locator('.node-mermaidBlock');
  await expect(lanes).toHaveCount(2);
  for (const lane of await lanes.all()) {
    await expect(lane.locator('.mermaid-renderer')).toHaveAttribute('data-render-settled', 'true');
    await expect(lane.locator('.mermaid-svg > svg')).toHaveAttribute('data-layout-settled', 'true');
    expect(
      await lane.evaluate(
        (el) => el.querySelector('svg') !== el.querySelector('.mermaid-svg > svg'),
      ),
    ).toBe(true);
  }
  // All clipboard APIs are replaced in this clean context, before any action.
  // Real rasterization is untouched; PNG bytes are decoded/inspected at write().
  await page.evaluate(() => {
    Object.assign(window, {
      exportWrites: [],
      exportTexts: [],
      rejectExport: false,
      expectedExportIndex: 0,
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        write: async (items: ClipboardItem[]) => {
          const blob = await items[0].getType('image/png');
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement('canvas');
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(bitmap, 0, 0);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let dark = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 180) dark++;
          }
          const state = window as typeof window & {
            exportWrites: unknown[];
            rejectExport: boolean;
            expectedExportIndex: number;
          };
          const source = document.querySelectorAll('.mermaid-svg > svg, svg.diagram-svg-layer')[
            state.expectedExportIndex
          ];
          const rect = source.getBoundingClientRect();
          const labelInk = [
            ...source.querySelectorAll('.nodeLabel p, .messageText, .node-label'),
          ].map((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            const box = range.getBoundingClientRect();
            const x = Math.max(0, Math.floor((box.x - rect.x) * 2));
            const y = Math.max(0, Math.floor((box.y - rect.y) * 2));
            const width = Math.min(canvas.width - x, Math.ceil(box.width * 2));
            const height = Math.min(canvas.height - y, Math.ceil(box.height * 2));
            let ink = 0;
            if (width > 0 && height > 0) {
              const pixels = ctx.getImageData(x, y, width, height).data;
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) < 180) ink++;
              }
            }
            return { text: label.textContent, ink };
          });
          state.exportWrites.push({
            width: bitmap.width,
            height: bitmap.height,
            dark,
            labelInk,
            png: canvas.toDataURL(),
          });
          bitmap.close();
          if (state.rejectExport) throw new DOMException('Isolated denial', 'NotAllowedError');
        },
        writeText: async (text: string) => {
          (window as typeof window & { exportTexts: string[] }).exportTexts.push(text);
        },
        read: () => {
          throw new Error('Clipboard reads prohibited');
        },
        readText: () => {
          throw new Error('Clipboard reads prohibited');
        },
      },
    });
  });
}

async function action(page: Page, index: number, name: string) {
  const lane = page.locator('.node-mermaidBlock').nth(index);
  await lane.hover();
  await lane.getByRole('button', { name: 'Diagram actions' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('note fullscreen selects each actual graph and preserves zoom, styling and focus', async ({
  page,
}, info) => {
  await mountNote(page);
  for (const [index, label] of ['Amber request', 'Cobalt request'].entries()) {
    const lane = page.locator('.node-mermaidBlock').nth(index);
    await lane.hover();
    const opener = lane.getByRole('button', { name: 'Fullscreen', exact: true });
    const originalStyle = await lane.locator('.mermaid-svg > svg').evaluate((svg) => {
      const el = svg.querySelector('.nodeLabel, .messageText')!;
      const css = getComputedStyle(el);
      return {
        font: css.fontFamily,
        size: css.fontSize,
        weight: css.fontWeight,
        color: css.color,
        fill: css.fill,
      };
    });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Fullscreen diagram view' });
    await expect(dialog).toBeVisible();
    await dialog.screenshot({ path: info.outputPath(`fullscreen-${index}.png`) });
    await expect(dialog).toContainText(label);
    expect(
      await dialog.locator('.fullscreen-diagram > svg').evaluate((svg) => {
        const el = svg.querySelector('.nodeLabel, .messageText')!;
        const css = getComputedStyle(el);
        return {
          font: css.fontFamily,
          size: css.fontSize,
          weight: css.fontWeight,
          color: css.color,
          fill: css.fill,
        };
      }),
    ).toEqual(originalStyle);
    await page.keyboard.press('+');
    await expect(dialog.getByTestId('zoom-pan-slider')).toHaveValue('1.25');
    await page.keyboard.press('0');
    await expect(dialog.getByTestId('zoom-pan-slider')).toHaveValue('1');
    if (index === 0) await page.keyboard.press('Escape');
    else await dialog.getByRole('button', { name: 'Close fullscreen view' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  }
});

test('downloaded SVG bytes and Copy SVG belong to each diagram, not the template or neighbor', async ({
  page,
}, info) => {
  await mountNote(page);
  for (const [index, label] of ['Amber request', 'Cobalt request'].entries()) {
    const pending = page.waitForEvent('download');
    await action(page, index, 'Download SVG');
    const download = await pending;
    const path = info.outputPath(`diagram-${index}.svg`);
    await download.saveAs(path);
    const bytes = await readFile(path, 'utf8');
    const parsed = await page.evaluate((svg) => {
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      return {
        text: doc.documentElement.textContent,
        errors: doc.querySelectorAll('parsererror').length,
        edges: doc.querySelectorAll('.flowchart-link, .messageLine0, .messageLine1').length,
      };
    }, bytes);
    // Text may contain semantic <wbr> markup; assert parsed labels, not raw substrings.
    expect(parsed.text).toContain(label);
    expect(parsed.text).not.toContain(index === 0 ? 'Cobalt request' : 'Amber request');
    expect(parsed.errors).toBe(0);
    expect(parsed.edges).toBeGreaterThan(0);
    const rendering = await page.evaluate(
      async ({ bytes, index }) => {
        const original = document.querySelectorAll('.mermaid-svg > svg')[index];
        const measure = (svg: Element) => {
          const label = svg.querySelector('.nodeLabel p, .messageText')!;
          const range = document.createRange();
          range.selectNodeContents(label);
          return range.getBoundingClientRect().width;
        };
        const originalWidth = measure(original);
        const frame = document.createElement('iframe');
        frame.sandbox.add('allow-same-origin');
        frame.style.cssText =
          'position:fixed;inset:0;width:1100px;height:700px;background:white;z-index:2000';
        const loaded = new Promise<void>((resolve) => {
          frame.onload = () => resolve();
        });
        frame.srcdoc = bytes;
        document.body.append(frame);
        await loaded;
        await frame.contentDocument!.fonts.ready;
        const exportedWidth = measure(frame.contentDocument!.querySelector('svg')!);
        return { originalWidth, exportedWidth };
      },
      { bytes, index },
    );
    await page
      .locator('iframe')
      .screenshot({ path: info.outputPath(`download-render-${index}.png`) });
    await page.locator('iframe').evaluate((frame) => frame.remove());
    expect(rendering.exportedWidth).toBeCloseTo(rendering.originalWidth, 0);
    await action(page, index, 'Copy SVG');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as typeof window & { exportTexts: string[] }).exportTexts.at(-1),
        ),
      )
      .toBe(bytes);
  }
});

test('real SVG-to-PNG rasterization succeeds independently of target selection', async ({
  page,
}, info) => {
  await mountNote(page);
  const result = await page.evaluate(async () => {
    const { copyDiagramImage } = await import('/src/lib/components/diagrams/diagram-export.ts');
    // Pass the actual graph's immediate parent: no preceding template to blame.
    try {
      await copyDiagramImage(document.querySelector<HTMLElement>('.mermaid-svg')!);
      return { error: null };
    } catch (error) {
      return { error: String(error) };
    }
  });
  await writeFile(info.outputPath('rasterization.json'), JSON.stringify(result, null, 2));
  expect(result.error).toBeNull();
  const writes = await page.evaluate(
    () =>
      (
        window as typeof window & {
          exportWrites: { width: number; height: number; dark: number; png: string }[];
        }
      ).exportWrites,
  );
  expect(writes).toHaveLength(1);
  expect(writes[0].width).toBeGreaterThan(400);
  expect(writes[0].height).toBeGreaterThan(50);
  expect(writes[0].dark).toBeGreaterThan(300);
  await writeFile(
    info.outputPath('copied-image.png'),
    Buffer.from(writes[0].png.split(',')[1], 'base64'),
  );
});

test('each Copy image control rasterizes the selected graph before isolated clipboard success or denial', async ({
  page,
}, info) => {
  await mountNote(page);
  for (let index = 0; index < 2; index++) {
    await page.evaluate((index) => {
      Object.assign(window, { expectedExportIndex: index, rejectExport: index === 1 });
    }, index);
    const rect = await page.locator('.mermaid-svg > svg').nth(index).boundingBox();
    await action(page, index, 'Copy image');
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as typeof window & { exportWrites: unknown[] }).exportWrites.length,
        ),
      )
      .toBe(index + 1);
    const result = await page.evaluate(
      (index) =>
        (
          window as typeof window & {
            exportWrites: {
              width: number;
              height: number;
              dark: number;
              labelInk: { text: string; ink: number }[];
              png: string;
            }[];
          }
        ).exportWrites[index],
      index,
    );
    expect(result.width).toBe(Math.round(rect!.width * 2));
    expect(result.height).toBe(Math.round(rect!.height * 2));
    expect(result.dark).toBeGreaterThan(300);
    expect(result.labelInk.map(({ text }) => text).join(' ')).toContain(
      index === 0 ? 'Amber request' : 'Cobalt request',
    );
    expect(result.labelInk.every(({ ink }) => ink > 30)).toBe(true);
    await writeFile(
      info.outputPath(`copy-${index}.png`),
      Buffer.from(result.png.split(',')[1], 'base64'),
    );
    await writeFile(
      info.outputPath(`copy-${index}.json`),
      JSON.stringify({ ...result, png: undefined }, null, 2),
    );
    await expect(
      page.locator('[data-sonner-toast][data-type="' + (index === 0 ? 'success' : 'error') + '"]'),
    ).toBeVisible();
  }
});

test('custom diagram exports retain graph labels and edges through the shared actions', async ({
  page,
}, info) => {
  const diagram = CUSTOM_WORKBENCH_CASES['custom-network'].diagram;
  await mountNote(page, `\`\`\`diagram\n${JSON.stringify(diagram)}\n\`\`\``);
  const lane = page.locator('.node-diagram_block');
  await expect(lane.locator('.diagram-renderer')).toHaveAttribute('data-diagram-settled', 'true');
  const customAction = async (name: string) => {
    await lane.hover();
    await lane.getByRole('button', { name: 'Diagram actions' }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  };
  await page.evaluate(() => {
    Object.assign(window, { expectedExportIndex: 2 });
  });
  const source = lane.locator('svg.diagram-svg-layer');
  await source.screenshot({ path: info.outputPath('custom-source.png') });
  await customAction('Copy image');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { exportWrites: unknown[] }).exportWrites.length,
      ),
    )
    .toBe(1);
  const result = await page.evaluate(
    () =>
      (
        window as typeof window & {
          exportWrites: {
            width: number;
            height: number;
            dark: number;
            labelInk: { text: string; ink: number }[];
            png: string;
          }[];
        }
      ).exportWrites[0],
  );
  await writeFile(
    info.outputPath('custom-copy.png'),
    Buffer.from(result.png.split(',')[1], 'base64'),
  );
  await writeFile(
    info.outputPath('custom-copy.json'),
    JSON.stringify({ ...result, png: undefined }, null, 2),
  );
  expect(result.labelInk).toHaveLength(4);
  expect(result.labelInk.every(({ ink }) => ink > 30)).toBe(true);
  const rect = (await source.boundingBox())!;
  expect(result.width).toBe(Math.round(rect.width * 2));
  expect(result.height).toBe(Math.round(rect.height * 2));
  const pending = page.waitForEvent('download');
  await customAction('Download SVG');
  const path = info.outputPath('custom-download.svg');
  await (await pending).saveAs(path);
  const bytes = await readFile(path, 'utf8');
  const typography = await page.evaluate(async (bytes) => {
    const measure = (root: Element) =>
      [...root.querySelectorAll('.edge-label-text, .node-label, .node-kind-label')].map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return {
          text: el.textContent?.trim(),
          width: range.getBoundingClientRect().width,
          height: range.getBoundingClientRect().height,
          font: getComputedStyle(el).font,
        };
      });
    const original = measure(document.querySelector('svg.diagram-svg-layer')!);
    const frame = document.createElement('iframe');
    frame.sandbox.add('allow-same-origin');
    frame.style.cssText =
      'position:fixed;inset:0;width:1100px;height:700px;background:white;z-index:2000';
    const loaded = new Promise<void>((resolve) => {
      frame.onload = () => resolve();
    });
    frame.srcdoc = bytes;
    document.body.append(frame);
    await loaded;
    await frame.contentDocument!.fonts.ready;
    return { original, exported: measure(frame.contentDocument!.querySelector('svg')!) };
  }, bytes);
  await page.locator('iframe').screenshot({ path: info.outputPath('custom-download.png') });
  await page.locator('iframe').evaluate((frame) => frame.remove());
  await writeFile(info.outputPath('custom-typography.json'), JSON.stringify(typography, null, 2));
  for (let i = 0; i < typography.original.length; i++) {
    expect(typography.exported[i].width).toBeCloseTo(typography.original[i].width, 0);
    expect(typography.exported[i].height).toBeCloseTo(typography.original[i].height, 0);
  }
  const parsed = await page.evaluate((bytes) => {
    const doc = new DOMParser().parseFromString(bytes, 'image/svg+xml');
    return {
      errors: doc.querySelectorAll('parsererror').length,
      labels: [...doc.querySelectorAll('.node-label')].map((el) => el.textContent?.trim()),
      edges: doc.querySelectorAll('.edge-path').length,
    };
  }, bytes);
  expect(parsed.errors).toBe(0);
  expect(parsed.labels.sort()).toEqual([
    'HMR channel',
    'Local browser',
    'Preview router',
    'Vite server',
  ]);
  expect(parsed.edges).toBeGreaterThan(0);
  expect(bytes).not.toContain('Amber request');
  await customAction('Copy SVG');
  expect(
    await page.evaluate(() => (window as typeof window & { exportTexts: string[] }).exportTexts[0]),
  ).toBe(bytes);
});

test('missing graph reports errors without stale fullscreen, neighbor export or clipboard writes', async ({
  page,
}) => {
  await mountNote(page);
  const lane = page.locator('.node-mermaidBlock').first();
  await lane.hover();
  await lane.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Amber request');
  await page.keyboard.press('Escape');
  await lane.locator('.mermaid-svg').evaluate((el) => el.remove());
  let downloads = 0;
  page.on('download', (download) => {
    downloads++;
    void download.cancel();
  });
  for (const name of ['Copy image', 'Copy SVG', 'Download SVG']) {
    await action(page, 0, name);
    await expect(page.locator('[data-sonner-toast][data-type="error"]').last()).toBeVisible();
  }
  await lane.hover();
  const opener = lane.getByRole('button', { name: 'Fullscreen', exact: true });
  await opener.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
  const writes = await page.evaluate(() => {
    const state = window as typeof window & { exportWrites: unknown[]; exportTexts: string[] };
    return [state.exportWrites.length, state.exportTexts.length];
  });
  expect(writes).toEqual([0, 0]);
  expect(downloads).toBe(0);
});
