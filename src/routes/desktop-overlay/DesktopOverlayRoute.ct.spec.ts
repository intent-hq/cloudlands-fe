import { readFileSync } from 'node:fs';
import { expect, test } from '../../test/ct-test';
import DesktopOverlayRoute from './+page.svelte';
import type { DesktopOverlayBridge } from '../../shared/desktop-overlay';

const shell = readFileSync(new URL('../../app.html', import.meta.url), 'utf8');

for (const kind of ['controls', 'glow'] as const) {
  test(`overlay ${kind} removes app splash and drag region before readiness`, async ({
    mount,
    page,
  }) => {
    const readiness: { splash: boolean; drag: boolean }[] = [];
    let stopped = 0;
    await page.exposeFunction('recordOverlayReady', (state: (typeof readiness)[number]) => {
      readiness.push(state);
    });
    await page.exposeFunction('recordOverlayStop', () => {
      stopped += 1;
    });
    await page.setViewportSize(
      kind === 'controls' ? { width: 480, height: 48 } : { width: 800, height: 600 },
    );
    await page.evaluate(
      ({ shell, kind }) => {
        const parsed = new DOMParser().parseFromString(shell, 'text/html');
        document.head.append(parsed.querySelector('style')!.cloneNode(true));
        for (const id of ['splash', 'app-drag-region'])
          document.body.append(parsed.getElementById(id)!.cloneNode(true));
        history.replaceState(null, '', `${location.pathname}?kind=${kind}`);
        const host = window as Window & {
          desktopOverlay: DesktopOverlayBridge;
          recordOverlayReady: (state: { splash: boolean; drag: boolean }) => void;
          recordOverlayStop: () => void;
        };
        host.desktopOverlay = {
          ready: () =>
            host.recordOverlayReady({
              splash: !!document.getElementById('splash'),
              drag: !!document.getElementById('app-drag-region'),
            }),
          stop: () => host.recordOverlayStop(),
          openAgent: () => {},
          setInteractive: () => {},
          onPulse: () => () => {},
        };
      },
      { shell, kind },
    );
    await mount(DesktopOverlayRoute);
    await expect.poll(() => readiness.length).toBe(1);
    await page.screenshot({ path: `.demo-artifacts/desktop-overlay-route-${kind}.png` });
    expect(readiness).toEqual([{ splash: false, drag: false }]);
    await expect(page.locator('#splash, #app-drag-region')).toHaveCount(0);
    if (kind === 'controls') {
      await expect(page.getByText('Intent is controlling your machine')).toBeVisible();
      await page.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect.poll(() => stopped).toBe(1);
    } else {
      await expect(page.locator('.glow')).toBeVisible();
      await expect(page.locator('.glow')).toHaveCSS('pointer-events', 'none');
    }
  });
}
