import { expect, openExample, outputJson } from '../lib/functional.mjs';

// Private observation helpers. Controls drive public props; these never write app state.
export const button = (host, name) => host.getByRole('button', { name, exact: true });
export const radio = (host, name) => host.getByRole('radio', { name, exact: true });
export const toggle = (host, name) => host.getByRole('switch', { name, exact: true });

export const openLeaf = (page, slug) => openExample(page, slug, slug);
export const popup = (page) => page.locator('[data-tooltip-content]').filter({ visible: true });

export async function choose(page, host, name, value) {
  await host.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: value, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

export async function openTasks(page, target) {
  await target.getByRole('progressbar').hover();
  await expect(popup(page)).toBeVisible();
  return popup(page);
}

export async function expectJson(host, name, expected) {
  await expect.poll(() => outputJson(host.getByLabel(name, { exact: true }))).toEqual(expected);
}

export async function captureLeaf(page, leaf, name, info) {
  await expect(leaf).toBeVisible();
  await leaf.scrollIntoViewIfNeeded();
  await page.evaluate(() => document.fonts.ready);
  const geometry = await leaf.evaluate((root) => {
    const bounds = (element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    return {
      viewport: { width: innerWidth, height: innerHeight },
      root: bounds(root),
      children: [...root.querySelectorAll('button, [role], img, svg, [aria-hidden]')].map(
        (element) => ({
          tag: element.tagName,
          role: element.getAttribute('role'),
          label: element.getAttribute('aria-label'),
          hidden: element.getAttribute('aria-hidden'),
          ...bounds(element),
        }),
      ),
    };
  });
  await info.attach(`${name}-bounds.json`, {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  await info.attach(`${name}-accessibility.txt`, {
    body: await leaf.ariaSnapshot(),
    contentType: 'text/plain',
  });
  await info.attach(`${name}.png`, {
    body: await leaf.screenshot({ animations: 'allow' }),
    contentType: 'image/png',
  });
  return geometry;
}

export async function expectContained(page, leaf) {
  const bounds = await leaf.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
}

export async function observeImages(page, host) {
  const events = [];
  const responses = [];
  page.on('response', (response) => {
    if (response.request().resourceType() === 'image') {
      responses.push({ url: response.url(), status: response.status() });
    }
  });
  await page.exposeBinding('__workspaceLeafImageObserved', (_source, event) => events.push(event));
  await host.evaluate((root) => {
    const observe = (event) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      const image = event.target;
      window.__workspaceLeafImageObserved({
        type: event.type,
        src: image.currentSrc || image.src,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
      });
    };
    root.addEventListener('load', observe, true);
    root.addEventListener('error', observe, true);
  });
  return { events, responses };
}

export async function expectDecoded(image) {
  await expect(image).toHaveCount(1);
  await expect
    .poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0))
    .toBe(true);
}
