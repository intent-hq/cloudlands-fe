import { expect, test, type Locator, type Page } from '@playwright/test';
import sharp from 'sharp';

type Pixel = [number, number, number, number];

const baseUrl = process.env.UI_PREVIEW_BASE_URL?.replace(/\/$/, '');
const probe: Pixel = [255, 0, 255, 255];
const cases = [
  {
    name: 'custom horizontal route · Light desktop',
    state: 'custom-disconnected-extremes',
    theme: 'light',
    width: 960,
    ownerSelector: '#custom-disconnected-extremes .edge-label-html',
    ownerText: 'a deliberately long horizontal route label',
  },
  {
    name: 'custom vertical route · Dark narrow',
    state: 'custom-disconnected-extremes',
    theme: 'dark',
    width: 320,
    ownerSelector: '#custom-disconnected-extremes .edge-label-html',
    ownerText: 'a deliberately long vertical route label',
  },
  {
    name: 'Mermaid HTML multiline · Nord compact',
    state: 'mermaid-multiline-labels',
    theme: 'nord',
    width: 420,
    ownerSelector: '#mermaid-multiline-labels foreignObject.edge-label-surface',
    ownerText: 'lazy import',
    surfaceSelector: ':scope > .labelBkg',
  },
  {
    name: 'Mermaid SVG vertical state route · Light desktop',
    state: 'mermaid-state',
    theme: 'light',
    width: 960,
    ownerSelector: '#mermaid-state g.edgeLabel',
    ownerText: 'User sends message',
    surfaceSelector: 'rect.background[data-label-feathered="true"]',
  },
  {
    name: 'Mermaid SVG sequence route · Dark narrow',
    state: 'mermaid-sequence-simple',
    theme: 'dark',
    width: 320,
    ownerSelector: '#mermaid-sequence-simple .edge-label-knockout[data-label-feathered="true"]',
  },
] as const;

test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to the running diagram preview server.');

async function openCase(page: Page, item: (typeof cases)[number]) {
  const params = new URLSearchParams({
    state: item.state,
    theme: item.theme === 'light' ? 'light' : 'dark',
    width: String(item.width),
    motion: 'reduced',
  });
  await page.goto(`${baseUrl}/sandbox/diagram-workbench?${params}`, {
    waitUntil: 'domcontentloaded',
  });
  const scene = page.getByTestId('catalog-scene');
  await expect(scene).toHaveAttribute('data-preview-ready', 'true', { timeout: 120_000 });
  await expect(scene).toHaveAttribute('data-preview-stable', 'true');
  expect(await page.evaluate(() => window.__INTENT_PREVIEW__?.current())).toEqual({
    slug: 'diagram-workbench',
    state: item.state,
    width: item.width,
    status: 'ready',
  });
  if (item.theme === 'nord') {
    await page.getByRole('button', { name: 'Color theme' }).click();
    await page.getByRole('option', { name: 'Nord', exact: true }).click();
  }
  const renderer = page.locator(`#${item.state} .mermaid-renderer`);
  if ((await renderer.count()) > 0) {
    await expect(renderer).toHaveAttribute('data-render-settled', 'true', { timeout: 120_000 });
  }
  await page.evaluate(() => document.fonts.ready);
}

const distance = (first: Pixel, second: Pixel) =>
  Math.max(...first.slice(0, 3).map((channel, index) => Math.abs(channel - second[index])));

async function expectFourSidedFeather(surface: Locator) {
  const contract = await surface.evaluate((node) => {
    const color = (value: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d')!;
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data] as [number, number, number, number];
    };
    const adjacentText = node.nextElementSibling?.matches('text') ? node.nextElementSibling : null;
    const text =
      (adjacentText as SVGGraphicsElement | null) ??
      (node instanceof SVGRectElement
        ? node.parentElement?.querySelector<SVGGraphicsElement>('text')
        : node.querySelector<HTMLElement>('span.edgeLabel, .edge-label-text'));
    const textStyle = text ? getComputedStyle(text) : null;
    const textContract = {
      textFilter: textStyle?.filter ?? '',
      textOpacity: textStyle?.opacity ?? '',
    };
    const svg = node.closest('svg');
    for (const graphic of svg?.querySelectorAll<SVGElement>('*:not(defs):not(defs *)') ?? []) {
      if (graphic.contains(node) || node.contains(graphic)) continue;
      graphic.style.setProperty('visibility', 'hidden', 'important');
    }
    if (node instanceof SVGRectElement) {
      const style = getComputedStyle(node);
      const duplicateUnderlays = [...(node.parentElement?.querySelectorAll('rect') ?? [])].filter(
        (candidate) =>
          candidate !== node &&
          ['x', 'y', 'width', 'height'].every(
            (attribute) => candidate.getAttribute(attribute) === node.getAttribute(attribute),
          ) &&
          color(getComputedStyle(candidate).fill)[3] > 0,
      );
      const underlay = node.cloneNode(false) as SVGRectElement;
      underlay.removeAttribute('class');
      underlay.removeAttribute('mask');
      underlay.style.setProperty('fill', 'rgb(255 0 255)', 'important');
      underlay.style.setProperty('visibility', 'visible', 'important');
      node.parentElement!.insertBefore(underlay, node);
      node.style.setProperty('visibility', 'visible', 'important');
      text?.style.setProperty('opacity', '0', 'important');
      return {
        kind: 'svg',
        surface: color(style.fill),
        mask: node.getAttribute('mask') ?? '',
        featherDefinitions: node
          .closest('svg')!
          .querySelectorAll(':scope > defs.edge-label-feather-defs').length,
        duplicateUnderlays: duplicateUnderlays.length,
        transitionDuration: style.transitionDuration,
        ...textContract,
      };
    }
    const host = node as HTMLElement;
    const style = getComputedStyle(host, '::before');
    const hardLayers = [host, ...host.querySelectorAll<HTMLElement>('*')].filter(
      (element) => color(getComputedStyle(element).backgroundColor)[3] > 0,
    );
    host.style.setProperty('background-color', 'rgb(255 0 255)', 'important');
    host.style.setProperty('visibility', 'visible', 'important');
    host.closest('foreignObject')?.style.setProperty('visibility', 'visible', 'important');
    text?.style.setProperty('opacity', '0', 'important');
    return {
      kind: 'html',
      surface: color(style.backgroundColor),
      mask: style.webkitMaskImage || style.maskImage,
      featherDefinitions: 0,
      duplicateUnderlays: hardLayers.length,
      transitionDuration: style.transitionDuration,
      ...textContract,
    };
  });
  const screenshot = await surface.screenshot({ animations: 'disabled' });
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({
    resolveWithObject: true,
  });
  const pixel = (x: number, y: number): Pixel => {
    const safeX = Math.max(0, Math.min(info.width - 1, x));
    const safeY = Math.max(0, Math.min(info.height - 1, y));
    const offset = (safeY * info.width + safeX) * info.channels;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  };
  const centerX = Math.floor(info.width / 2);
  const centerY = Math.floor(info.height / 2);
  const edgeX = Math.min(1, info.width - 1);
  const edgeY = Math.min(1, info.height - 1);
  const outer = [
    pixel(edgeX, centerY),
    pixel(info.width - 1 - edgeX, centerY),
    pixel(centerX, edgeY),
    pixel(centerX, info.height - 1 - edgeY),
    pixel(edgeX, edgeY),
    pixel(info.width - 1 - edgeX, edgeY),
    pixel(edgeX, info.height - 1 - edgeY),
    pixel(info.width - 1 - edgeX, info.height - 1 - edgeY),
  ];
  const opaqueDistance = distance(pixel(centerX, centerY), contract.surface);
  const surfaceProbeDistance = distance(contract.surface, probe);
  expect(contract.mask).not.toBe('none');
  expect(contract.mask).not.toBe('');
  expect(contract.duplicateUnderlays).toBe(0);
  expect(contract.textFilter).toBe('none');
  expect(contract.textOpacity).toBe('1');
  expect(
    contract.transitionDuration.split(',').every((duration) => parseFloat(duration) <= 0.00001),
  ).toBe(true);
  if (contract.kind === 'svg') expect(contract.featherDefinitions).toBe(1);
  expect(surfaceProbeDistance).toBeGreaterThan(80);
  expect(Math.max(...outer.map((sample) => distance(sample, probe)))).toBeLessThan(
    surfaceProbeDistance - 10,
  );
  expect(opaqueDistance).toBeLessThanOrEqual(12);
}

for (const item of cases) {
  test(`feathers ${item.name} on every side without softening text`, async ({ page }) => {
    test.setTimeout(180_000);
    await openCase(page, item);
    let owner = page.locator(item.ownerSelector).filter({ visible: true });
    if ('ownerText' in item) owner = owner.filter({ hasText: item.ownerText });
    const firstOwner = owner.first();
    const surface =
      'surfaceSelector' in item ? firstOwner.locator(item.surfaceSelector) : firstOwner;
    await expect(surface).toBeVisible();
    await expectFourSidedFeather(surface);
  });
}
