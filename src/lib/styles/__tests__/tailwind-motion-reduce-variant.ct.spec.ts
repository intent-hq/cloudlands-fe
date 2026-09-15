import { expect, test, type Locator, type Page } from '@playwright/experimental-ct-svelte';
import TailwindMotionReduceHost from './TailwindMotionReduceHost.svelte';

// Real-browser contract for the `motion-reduce:` Tailwind variant override in
// app.css: the generated utilities must follow `--motion-reduced`, so the root
// `data-reduce-motion` attribute (battery saver) switches them exactly like the
// OS `prefers-reduced-motion` media query does. The tokens.css blanket already
// equalizes durations, so this probes the surfaces only the variant controls:
// animation-name, backdrop-filter, and transition-property.

interface Probe {
  animationName: string;
  backdropFilter: string;
  transitionProperty: string;
}

const REDUCED: Probe = {
  animationName: 'none',
  backdropFilter: 'none',
  transitionProperty: 'none',
};

async function readProbe(locator: Locator): Promise<Probe> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      backdropFilter: style.backdropFilter,
      transitionProperty: style.transitionProperty,
    };
  });
}

function expectAuthored(probe: Probe) {
  expect(probe.animationName).not.toBe('none');
  expect(probe.backdropFilter).toBe('blur(1px)');
  expect(probe.transitionProperty.split(',').map((p) => p.trim())).toContain('transform');
}

async function setBatteryAttribute(page: Page, on: boolean) {
  await page.evaluate((enabled) => {
    if (enabled) document.documentElement.setAttribute('data-reduce-motion', '');
    else document.documentElement.removeAttribute('data-reduce-motion');
  }, on);
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('full motion: motion-reduce utilities stay inactive', async ({ mount }) => {
  const component = await mount(TailwindMotionReduceHost);
  expectAuthored(await readProbe(component.getByTestId('motion-reduce-probe')));
});

test('OS preference: motion-reduce utilities apply', async ({ mount, page }) => {
  const component = await mount(TailwindMotionReduceHost);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await readProbe(component.getByTestId('motion-reduce-probe'))).toEqual(REDUCED);
});

test('battery mode: the root attribute applies motion-reduce utilities without the media query', async ({
  mount,
  page,
}) => {
  const component = await mount(TailwindMotionReduceHost);
  await setBatteryAttribute(page, true);
  expect(await readProbe(component.getByTestId('motion-reduce-probe'))).toEqual(REDUCED);
});

test('both sources: motion-reduce utilities stay applied', async ({ mount, page }) => {
  const component = await mount(TailwindMotionReduceHost);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setBatteryAttribute(page, true);
  expect(await readProbe(component.getByTestId('motion-reduce-probe'))).toEqual(REDUCED);
});

test('restored: removing the attribute returns the authored utilities', async ({ mount, page }) => {
  const component = await mount(TailwindMotionReduceHost);
  const probe = component.getByTestId('motion-reduce-probe');
  await setBatteryAttribute(page, true);
  expect(await readProbe(probe)).toEqual(REDUCED);
  await setBatteryAttribute(page, false);
  expectAuthored(await readProbe(probe));
});
