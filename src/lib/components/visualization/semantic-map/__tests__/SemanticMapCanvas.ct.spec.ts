import { expect, test, type Page } from '@playwright/experimental-ct-svelte';
import SemanticMapCanvasHost from './SemanticMapCanvasHost.svelte';

async function installRuntimeMediaMock(page: Page) {
  await page.evaluate(() => {
    const nativeMatchMedia = window.matchMedia.bind(window);
    let reducedMotion = false;
    let devicePixelRatio = 1;
    const queries = new Set<MediaQueryList>();
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      get: () => devicePixelRatio,
    });
    window.matchMedia = (query: string) => {
      if (query !== '(prefers-reduced-motion: reduce)' && !query.startsWith('(resolution:'))
        return nativeMatchMedia(query);
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const mediaQuery = {
        media: query,
        get matches() {
          return query === '(prefers-reduced-motion: reduce)' ? reducedMotion : true;
        },
        onchange: null,
        addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
          listeners.delete(listener),
        addListener: (listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
        removeListener: (listener: (event: MediaQueryListEvent) => void) =>
          listeners.delete(listener),
        dispatchEvent: () => true,
        __notify() {
          const event = { matches: this.matches, media: query } as MediaQueryListEvent;
          for (const listener of [...listeners]) listener(event);
        },
      } as MediaQueryList & { __notify(): void };
      queries.add(mediaQuery);
      return mediaQuery;
    };
    Object.defineProperty(window, '__semanticMapRuntime', {
      configurable: true,
      value: {
        setDpr(value: number) {
          devicePixelRatio = value;
          for (const query of [...queries]) {
            if (query.media.startsWith('(resolution:'))
              (query as MediaQueryList & { __notify(): void }).__notify();
          }
        },
        setReducedMotion(value: boolean) {
          reducedMotion = value;
          for (const query of [...queries]) {
            if (query.media === '(prefers-reduced-motion: reduce)')
              (query as MediaQueryList & { __notify(): void }).__notify();
          }
        },
      },
    });
  });
}

test('the application wrapper owns focus and region keyboard navigation', async ({
  mount,
  page,
}) => {
  const component = await mount(SemanticMapCanvasHost);
  const application = component.getByRole('application');
  const selected = component.getByTestId('selected-region');

  await component.getByTestId('before-map').focus();
  await page.keyboard.press('Tab');
  await expect(application).toBeFocused();
  await expect(application.locator('canvas')).toHaveAttribute('aria-hidden', 'true');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(selected).toHaveAttribute('data-region', 'first');

  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(selected).toHaveAttribute('data-region', 'second');

  await page.keyboard.press('Escape');
  await expect(selected).toHaveAttribute('data-region', '');
});

test('pointer targets follow the organic hull instead of its old bounding circle', async ({
  mount,
  page,
}) => {
  await installRuntimeMediaMock(page);
  const component = await mount(SemanticMapCanvasHost);
  const canvas = component.locator('canvas');
  const selected = component.getByTestId('selected-region');

  await canvas.click({ position: { x: 250, y: 180 } });
  await expect(selected).toHaveAttribute('data-region', 'first');
  await canvas.click({ position: { x: 180, y: 120 } });
  await expect(selected).toHaveAttribute('data-region', '');
});

test('reduced-motion changes snap the current hull tween after mount', async ({ mount, page }) => {
  await installRuntimeMediaMock(page);
  const component = await mount(SemanticMapCanvasHost);
  const canvas = component.locator('canvas');

  await canvas.click({ position: { x: 250, y: 180 } });
  await page.evaluate(() =>
    (
      window as typeof window & {
        __semanticMapRuntime: { setReducedMotion(value: boolean): void };
      }
    ).__semanticMapRuntime.setReducedMotion(true),
  );
  await canvas.hover({ position: { x: 325, y: 180 } });
  await expect(component.getByText('First region', { exact: true })).toBeVisible();
});

test('visibility pauses and resumes a hull tween without a time jump', async ({ mount, page }) => {
  await installRuntimeMediaMock(page);
  const component = await mount(SemanticMapCanvasHost);
  const canvas = component.locator('canvas');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await canvas.click({ position: { x: 250, y: 180 } });
  await page.waitForTimeout(350);
  await canvas.evaluate((element) => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        clientX: rect.left + 325,
        clientY: rect.top + 180,
      }),
    );
  });
  await expect(component.getByText('First region', { exact: true })).toBeHidden();
  await page.waitForTimeout(350);
  await canvas.hover({ position: { x: 325, y: 180 } });
  await expect(component.getByText('First region', { exact: true })).toBeVisible();
});

test('a DPR change resizes the canvas backing store after mount', async ({ mount, page }) => {
  await installRuntimeMediaMock(page);
  const component = await mount(SemanticMapCanvasHost);
  const canvas = component.locator('canvas');
  await expect.poll(() => canvas.evaluate((element) => element.width)).toBe(640);

  await page.evaluate(() =>
    (
      window as typeof window & { __semanticMapRuntime: { setDpr(value: number): void } }
    ).__semanticMapRuntime.setDpr(2),
  );
  await expect.poll(() => canvas.evaluate((element) => element.width)).toBe(1280);
  await expect.poll(() => canvas.evaluate((element) => element.height)).toBe(720);
});
