import { expect, test } from '../../../../test/ct-test';
import Preview from './ChatAuthorPresentationHost.svelte';

for (const width of [360, 840]) {
  test(`chat authors expose forge details by hover and keyboard at ${width}px`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const component = await mount(Preview, { props: { width } });
    const labels = ['The Octocat · @octocat', 'Same Person · @same', 'Same Person · @same'];
    const names = component.getByTestId('user-message-author-name');
    for (const [i, label] of labels.entries()) await expect(names.nth(i)).toHaveText(label);
    await expect(component.getByTestId('user-message-author-role')).toHaveText('Host member');
    await expect(component).not.toContainText('526899');
    await expect(component).not.toContainText('gitlab@');
    const details = [
      'The Octocat · @octocat · GitHub',
      'Same Person · @same · GitLab (gitlab.com)',
      'Same Person · @same · GitLab (forge.example:8443)',
    ];
    for (const surface of ['user-message-author', 'queued-message-author']) {
      for (const [i, detail] of details.entries()) {
        const author = component.getByTestId(surface).nth(i);
        const trigger =
          surface === 'user-message-author'
            ? author.locator('[data-tooltip-trigger]')
            : author.locator('..');
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await trigger.hover();
        const tooltip = page.getByRole('tooltip', { name: detail, exact: true });
        await expect(tooltip).toHaveText(detail);
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);
        await page.mouse.move(width - 1, 899);
        await trigger.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect(trigger).toBeFocused();
        await expect(tooltip).toHaveText(detail);
        await expect(trigger).toHaveAttribute(
          'aria-describedby',
          (await tooltip.getAttribute('id')) ?? 'missing',
        );
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);
        await page.keyboard.press('Tab');
      }
    }
    await page.mouse.move(width - 1, 899);
    await page.keyboard.press('Escape');
    await page.evaluate(() => document.fonts.ready);
    await testInfo.attach(`chat-authors-${width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    const memberTrigger = component
      .getByTestId('user-message-author')
      .nth(2)
      .locator('[data-tooltip-trigger]');
    await memberTrigger.focus();
    await expect(page.getByRole('tooltip')).toContainText('forge.example:8443');
    await component.update({ props: { width, host: 'other.example' } });
    await expect(page.getByRole('tooltip')).toHaveText(
      'Same Person · @same · GitLab (other.example)',
    );
    await expect(component.getByTestId('user-message-author-role')).toHaveText('Host member');
    await page.keyboard.press('Escape');
    const queueTrigger = component.getByTestId('queued-message-author').nth(2).locator('..');
    await queueTrigger.hover();
    await expect(page.getByRole('tooltip')).toHaveText(
      'Same Person · @same · GitLab (other.example)',
    );
    await testInfo.attach(`chat-author-tooltip-${width}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
}
