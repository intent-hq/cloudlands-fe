import { test } from '../../../../test/ct-test';
import MobilePairingQr from '../mobile-pairing-qr.preview.svelte';
import { assertMobilePairingQrGeometry } from './mobile-pairing-qr.assertions';

for (const width of [320, 1100]) {
  test(`QR fills its content width without overflow at ${width}px`, async ({ mount, page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const root = await mount(MobilePairingQr, {
      hooksConfig: { geometrySnapshot: { scene: 'mobile-pairing-qr', state: 'ready' } },
    });
    await page.evaluate(() => document.fonts.ready);
    await root.getByRole('button', { name: 'Show QR Code', exact: true }).click();
    await assertMobilePairingQrGeometry(page);
    await page
      .getByRole('dialog')
      .screenshot({ path: `/tmp/cool-bee-qr-final-${width}.png`, animations: 'disabled' });
  });
}
