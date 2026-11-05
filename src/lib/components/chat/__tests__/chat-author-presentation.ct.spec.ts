import { expect, test } from '../../../../test/ct-test';
import Preview from './ChatAuthorPresentationHost.svelte';

for (const width of [360, 840]) {
  test(`chat authors show names and roles at ${width}px`, async ({ mount, page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { width } });
    const labels = ['The Octocat · @octocat', 'Same Person · @same', 'Same Person · @same'];
    const names = component.getByTestId('user-message-author-name');
    for (const [i, label] of labels.entries()) await expect(names.nth(i)).toHaveText(label);
    await expect(component.getByTestId('user-message-author-role')).toHaveText('Owner');
    await expect(
      component.getByTestId('user-message-author').nth(2).getByTestId('user-message-author-role'),
    ).toHaveCount(0);
    await expect(component.getByTestId('user-message-author-name').nth(4)).toHaveText(
      'Owner Person · @owner',
    );
    await expect(component).not.toContainText('Host member');
    await expect(component).not.toContainText('526899');
    await expect(component).not.toContainText('gitlab@');
    await testInfo.attach(`chat-authors-${width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
