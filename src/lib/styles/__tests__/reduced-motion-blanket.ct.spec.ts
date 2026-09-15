import { expect, test, type Page } from '@playwright/experimental-ct-svelte';

// Real-browser contract for the tokens.css global motion blanket: the root
// `data-reduce-motion` attribute (battery saver) must zero the same surfaces
// as the OS `prefers-reduced-motion` media query — root, root pseudo-elements,
// descendants, and descendant pseudo-elements — and restoring the attribute
// must return every surface to its authored motion.

type Target = 'root' | 'root::before' | 'root::after' | 'child' | 'child::before' | 'child::after';
const TARGETS: Target[] = [
  'root',
  'root::before',
  'root::after',
  'child',
  'child::before',
  'child::after',
];

interface Motion {
  transitionDuration: string;
  animationDuration: string;
  animationIterationCount: string;
}

const AUTHORED: Motion = {
  transitionDuration: '3s',
  animationDuration: '4s',
  animationIterationCount: 'infinite',
};
// Chromium serializes the blanket's `0.01ms` as seconds.
const REDUCED: Motion = {
  transitionDuration: '1e-05s',
  animationDuration: '1e-05s',
  animationIterationCount: '1',
};

const PROBE_ID = 'reduced-motion-blanket-probe';

async function installProbe(page: Page) {
  await page.evaluate((id) => {
    const style = document.createElement('style');
    style.id = `${id}-style`;
    style.textContent = `
      @keyframes ${id}-spin { to { transform: rotate(1turn); } }
      html, html::before, html::after, #${id}, #${id}::before, #${id}::after {
        content: '';
        transition: opacity 3s linear;
        animation: ${id}-spin 4s linear infinite;
      }
    `;
    document.head.append(style);
    const child = document.createElement('div');
    child.id = id;
    document.body.append(child);
  }, PROBE_ID);
}

async function readMotion(page: Page): Promise<Record<Target, Motion>> {
  return page.evaluate((id) => {
    const root = document.documentElement;
    const child = document.getElementById(id)!;
    const read = (element: Element, pseudo?: string) => {
      const style = getComputedStyle(element, pseudo);
      return {
        transitionDuration: style.transitionDuration,
        animationDuration: style.animationDuration,
        animationIterationCount: style.animationIterationCount,
      };
    };
    return {
      root: read(root),
      'root::before': read(root, '::before'),
      'root::after': read(root, '::after'),
      child: read(child),
      'child::before': read(child, '::before'),
      'child::after': read(child, '::after'),
    };
  }, PROBE_ID);
}

async function setBatteryAttribute(page: Page, on: boolean) {
  await page.evaluate((enabled) => {
    if (enabled) document.documentElement.setAttribute('data-reduce-motion', '');
    else document.documentElement.removeAttribute('data-reduce-motion');
  }, on);
}

function expectAll(actual: Record<Target, Motion>, expected: Motion) {
  for (const target of TARGETS) {
    expect(actual[target], target).toEqual(expected);
  }
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await installProbe(page);
});

test('full motion: authored durations stay in effect everywhere', async ({ page }) => {
  expectAll(await readMotion(page), AUTHORED);
});

test('battery mode: the root attribute blankets root, root pseudos, descendants, and descendant pseudos', async ({
  page,
}) => {
  await setBatteryAttribute(page, true);
  expectAll(await readMotion(page), REDUCED);
});

test('OS preference: the media blanket covers the same surfaces', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expectAll(await readMotion(page), REDUCED);
});

test('both sources: motion stays reduced', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setBatteryAttribute(page, true);
  expectAll(await readMotion(page), REDUCED);
});

test('restored: removing the attribute returns every surface to authored motion', async ({
  page,
}) => {
  await setBatteryAttribute(page, true);
  expectAll(await readMotion(page), REDUCED);
  await setBatteryAttribute(page, false);
  expectAll(await readMotion(page), AUTHORED);
});

test('--motion-reduced mirrors both sources on the root', async ({ page }) => {
  const flag = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--motion-reduced').trim(),
    );
  expect(await flag()).toBe('0');
  await setBatteryAttribute(page, true);
  expect(await flag()).toBe('1');
  await setBatteryAttribute(page, false);
  expect(await flag()).toBe('0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await flag()).toBe('1');
});
