import { test } from '../../../../test/ct-test';
import Preview from '../sidebar-list-rows.preview.svelte';
import { assertSidebarListRows } from './sidebar-list-row-contract';

for (const cardWidth of [320, 240]) {
  test(`expanded sidebar labels and keyboard actions fit ${cardWidth}px cards`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { cardWidth } });
    await assertSidebarListRows(component, page);
    await testInfo.attach('sidebar-hidden-browser-restored', {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
  });
}
