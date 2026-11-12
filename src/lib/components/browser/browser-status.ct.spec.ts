import { expect, test } from '../../../test/ct-test';
import ViewerPreview, { ONLINE_HOST, OFFLINE_HOST } from './browser-viewer-tab.preview.svelte';
import BrowserHarness from '$features/layout/tab-types/__tests__/mocks/BrowserTabTypeHeaderHarness.svelte';

const mirror = {
  url: 'https://intentapp.dev/docs',
  title: 'Intent docs',
  host: ONLINE_HOST,
};

test('host details follow disconnect and reconnect without losing recovery actions', async ({
  mount,
  page,
}, testInfo) => {
  const component = await mount(ViewerPreview, {
    props: {
      mirror,
      width: 640,
      notices: { agentId: 'docs-agent', agentName: 'Docs agent', mirrored: true },
    },
  });
  const status = component.getByRole('button', { name: 'Runs on office-linux' });
  await status.focus();
  await status.press('Enter');
  const details = page.locator('[data-slot="popover-content"]');
  await expect(details).toContainText('cookies and page state');
  await page.keyboard.press('Escape');
  await expect(status).toBeFocused();

  await component.update({ props: { mirror: { ...mirror, host: OFFLINE_HOST } } });
  const offline = component.getByRole('button', { name: 'Offline: travel-air' });
  await expect(component.getByRole('button', { name: 'Refresh page' })).toBeDisabled();
  await expect(component.getByRole('button', { name: 'Edit browser address' })).toBeDisabled();
  await offline.click();
  await expect(details).toContainText('travel-air is disconnected');
  await details.getByRole('button', { name: 'Close anyway' }).click();
  await expect(component.locator('[data-preview-last-action]')).toHaveText('force-close');

  await component.update({ props: { mirror } });
  await expect(status).toBeVisible();
  await expect(component.getByRole('button', { name: 'Refresh page' })).toBeEnabled();
  await expect(component.getByRole('button', { name: 'Edit browser address' })).toBeEnabled();
  await testInfo.attach('reconnected-browser', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
});

for (const theme of ['light', 'dark'] as const) {
  test(`offline recovery stays reachable in a narrow ${theme} panel`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(ViewerPreview, {
      props: { mirror: { ...mirror, host: OFFLINE_HOST }, width: 240 },
    });
    const status = component.getByRole('button', { name: 'Offline: travel-air' });
    await status.focus();
    await status.press('Enter');
    const details = page.locator('[data-slot="popover-content"]');
    const close = details.getByRole('button', { name: 'Close anyway' });
    await expect(close).toBeVisible();
    await close.focus();
    await expect(close).toBeFocused();
    const triggerBox = (await status.boundingBox())!;
    const toolbarBox = (await component.locator('[data-browser-toolbar]').boundingBox())!;
    expect(triggerBox.x).toBeGreaterThanOrEqual(toolbarBox.x);
    expect(triggerBox.x + triggerBox.width).toBeLessThanOrEqual(toolbarBox.x + toolbarBox.width);
    await testInfo.attach(`offline-recovery-${theme}`, {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    await page.keyboard.press('Escape');
    await expect(status).toBeFocused();
  });
}

test('page error details keep the browser mounted and Retry reloads the same guest', async ({
  mount,
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 400, height: 260 });
  const component = await mount(BrowserHarness, {
    props: {
      tabs: [
        {
          id: 'browser-error',
          type: 'browser',
          title: 'Intent docs',
          browserUrl: mirror.url,
          closable: true,
        },
      ],
      activeTabId: 'browser-error',
      renderPanelHeader: true,
      width: 360,
    },
  });
  const guest = component.locator('webview');
  const failure = 'The server could not be reached. Check the connection and try again. '.repeat(4);
  await guest.evaluate((element, errorDescription) => {
    const webview = element as HTMLElement & {
      getWebContentsId: () => number;
      getURL: () => string;
      reload: () => void;
      executeJavaScript: () => Promise<undefined>;
    };
    webview.getWebContentsId = () => 101;
    webview.getURL = () => 'https://intentapp.dev/docs';
    webview.executeJavaScript = async () => undefined;
    webview.reload = () => {
      webview.dataset.reloadCount = '1';
      webview.dispatchEvent(
        Object.assign(new Event('did-navigate'), { url: 'https://intentapp.dev/docs' }),
      );
    };
    webview.dispatchEvent(new Event('dom-ready'));
    webview.dispatchEvent(
      Object.assign(new Event('did-fail-load'), {
        errorCode: -105,
        errorDescription,
        validatedURL: 'https://intentapp.dev/docs',
      }),
    );
  }, failure);
  const status = component.getByRole('button', { name: 'Page error', exact: true });
  await status.click();
  const details = page.locator('[data-slot="popover-content"]');
  await expect(details).toContainText(failure.trim());
  await expect(component.getByRole('button', { name: 'Edit browser address' })).toBeEnabled();
  const retry = details.getByRole('button', { name: 'Retry', exact: true });
  const retryBox = (await retry.boundingBox())!;
  expect(retryBox.y + retryBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await testInfo.attach('page-error-details', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
  await retry.click();
  await expect(guest).toHaveAttribute('data-reload-count', '1');
  await expect(status).toHaveCount(0);
  const refresh = component.getByRole('button', { name: 'Refresh page' });
  await expect(refresh).toBeFocused();

  await guest.evaluate((element) => {
    const webview = element as HTMLElement & { getURL: () => string };
    webview.getURL = () => {
      throw new Error('Guest closed');
    };
    webview.dispatchEvent(new Event('destroyed'));
  });
  await expect(guest).toHaveCount(0);
  await expect(component.getByRole('alert')).toContainText('The page closed itself');
  await component.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(guest).toHaveCount(1);
  await expect(refresh).toBeFocused();
});
