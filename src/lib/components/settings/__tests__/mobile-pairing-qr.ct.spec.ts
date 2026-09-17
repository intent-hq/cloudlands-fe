import { test } from '@playwright/experimental-ct-svelte';
import MobilePairingQr from '../mobile-pairing-qr.preview.svelte';
import { assertMobilePairingQrGeometry } from './mobile-pairing-qr.assertions';

for (const width of [320, 1100]) {
  test(`QR fills its content width without overflow at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(MobilePairingQr);
    await page.evaluate(() => document.fonts.ready);
    await root.locator('#websocket-mobile-pairing button').click();
    await assertMobilePairingQrGeometry(page);
  });
}
