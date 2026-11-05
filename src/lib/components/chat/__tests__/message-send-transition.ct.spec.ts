import { expect, test } from '../../../../test/ct-test';
import MessageSendTransitionHost from './MessageSendTransitionHost.svelte';

test('keeps rapid sends owned by one panel', async ({ mount, page }) => {
  const component = await mount(MessageSendTransitionHost, {
    props: { panelId: 'rapid', rapidCount: 2 },
  });
  await component.getByTestId('send-button').click();
  await expect(component.getByTestId('settled-count')).toHaveText('2');
  await expect(component.getByTestId('send-target')).toHaveCount(2);
  await expect(page.locator('[data-message-send-transition]')).toHaveCount(0);
});

test('follows the bottom without smooth-scroll competition and preserves manual scroll', async ({
  mount,
  page,
}) => {
  await mount(MessageSendTransitionHost, {
    props: { panelId: 'follow', subscriptionOpen: true },
  });
  const followed = page.locator('[data-panel-id="follow"]');
  await followed.getByTestId('send-button').click();
  await expect(followed.getByTestId('settled-count')).toHaveText('1');
  await expect(followed.getByTestId('subscription-card')).toContainText('Expanded subscriptions');
  const followPosition = await followed.getByTestId('send-scroll').evaluate((node) => ({
    top: node.scrollTop,
    bottom: node.scrollHeight - node.clientHeight,
  }));
  expect(Math.abs(followPosition.top - followPosition.bottom)).toBeLessThan(1);

  await mount(MessageSendTransitionHost, {
    props: { panelId: 'manual', followBottom: false, subscriptionOpen: true },
  });
  const manual = page.locator('[data-panel-id="manual"]');
  await manual.getByTestId('send-scroll').evaluate((node) => (node.scrollTop = 48));
  await manual.getByTestId('send-button').click();
  await expect(manual.getByTestId('settled-count')).toHaveText('1');
  await expect
    .poll(() => manual.getByTestId('send-scroll').evaluate((node) => node.scrollTop))
    .toBe(48);
});

test('stays continuous when response content starts during the send', async ({ mount }) => {
  const component = await mount(MessageSendTransitionHost, {
    props: { panelId: 'response', responseStart: true },
  });
  await component.getByTestId('send-button').click();
  await expect(component.getByTestId('response-start')).toBeVisible();
  await expect(component.getByTestId('settled-count')).toHaveText('1');
  await expect(component.getByTestId('send-target')).toBeVisible();
});

test('keeps simultaneous panel transitions isolated and honors reduced motion', async ({
  mount,
  page,
}) => {
  await mount(MessageSendTransitionHost, { props: { panelId: 'left' } });
  await mount(MessageSendTransitionHost, { props: { panelId: 'right' } });
  const left = page.locator('[data-panel-id="left"]');
  const right = page.locator('[data-panel-id="right"]');
  await left.getByTestId('send-button').click();
  await right.getByTestId('send-button').click();
  await expect(left.getByTestId('settled-count')).toHaveText('1');
  await expect(right.getByTestId('settled-count')).toHaveText('1');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await left.getByTestId('send-button').click();
  await expect(left.getByTestId('settled-count')).toHaveText('2');
  expect(await page.locator('[data-message-send-transition]').count()).toBe(0);
});
