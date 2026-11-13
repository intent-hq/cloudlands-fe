import { expect, test } from '../../../test/ct-test';
import ViewerPreview, { ONLINE_HOST, OFFLINE_HOST } from './browser-viewer-tab.preview.svelte';
import BrowserHarness from '$features/layout/tab-types/__tests__/mocks/BrowserTabTypeHeaderHarness.svelte';
import EmbeddedPreview from './embedded-browser.preview.svelte';

const mirror = {
  url: 'https://intentapp.dev/docs',
  title: 'Intent docs',
  host: ONLINE_HOST,
};

test('connection errors appear in the preview and Retry recovers the same guest', async ({
  mount,
}, testInfo) => {
  const component = await mount(EmbeddedPreview, { props: { error: 'connection' } });
  const guest = component.locator('webview');
  await guest.evaluate((element) => (element.dataset.retainedGuest = 'true'));
  const error = component.locator('[data-browser-load-error]');
  await expect(error.getByRole('alert')).toContainText('Cannot connect to localhost:5173');
  await expect(component.getByRole('button', { name: 'Edit browser address' })).toBeEnabled();
  await testInfo.attach('connection-error-in-preview', {
    body: await component.screenshot(),
    contentType: 'image/png',
  });
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(component.locator('[data-preview-last-action]')).toHaveText('refresh');
  await expect(guest).toHaveAttribute('data-retained-guest', 'true');
  await expect(error).toHaveCount(0);
  await expect(component.getByRole('button', { name: 'Refresh page' })).toBeFocused();
});

test('subframe failures and cancelled navigations do not cover the page', async ({ mount }) => {
  const component = await mount(EmbeddedPreview);
  await expect(component).toHaveAttribute('data-embedded-browser-fixture', 'true');
  const guest = component.locator('webview');
  for (const fields of [
    { isMainFrame: false, errorCode: -102 },
    { isMainFrame: true, errorCode: -3 },
  ]) {
    await guest.evaluate((element, failure) => {
      element.dispatchEvent(
        Object.assign(new Event('did-fail-load'), {
          validatedURL: 'http://localhost:5173',
          ...failure,
        }),
      );
    }, fields);
    await expect(component.locator('[data-browser-load-error]')).toHaveCount(0);
    await expect(component.getByRole('button', { name: 'Page error', exact: true })).toHaveCount(0);
  }
});

test('main-frame same-document navigation clears the error without replacing the guest', async ({
  mount,
}) => {
  const component = await mount(EmbeddedPreview, { props: { error: 'connection' } });
  const error = component.locator('[data-browser-load-error]');
  await expect(error).toBeVisible();
  const guest = component.locator('webview');
  await guest.evaluate((element) => {
    element.dataset.retainedGuest = 'true';
    element.dispatchEvent(
      Object.assign(new Event('did-navigate-in-page'), {
        isMainFrame: false,
        url: 'https://iframe.invalid/#recovered',
      }),
    );
  });
  await expect(error).toBeVisible();
  await guest.evaluate((element) => {
    element.dispatchEvent(
      Object.assign(new Event('did-navigate-in-page'), {
        isMainFrame: true,
        url: 'http://localhost:5173/#recovered',
      }),
    );
  });
  await expect(error).toHaveCount(0);
  await expect(guest).toHaveAttribute('data-retained-guest', 'true');
});

test('a pending retry keeps keyboard focus outside the covered guest', async ({ mount }) => {
  const component = await mount(EmbeddedPreview, { props: { error: 'connection' } });
  const error = component.locator('[data-browser-load-error]');
  await expect(error).toBeVisible();
  const guest = component.locator('webview');
  await guest.evaluate((element) => {
    element.tabIndex = 0;
    Object.assign(element, { reload: () => {} });
  });
  await error.getByRole('button', { name: 'Retry', exact: true }).click();
  const refresh = component.getByRole('button', { name: 'Refresh page' });
  await expect(refresh).toBeFocused();
  await guest.focus();
  await expect(refresh).toBeFocused();
  await expect(error).toBeVisible();
});

for (const theme of ['light', 'dark'] as const) {
  test(`long preview errors keep keyboard recovery reachable in a narrow ${theme} panel`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 280, height: 260 });
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    const component = await mount(EmbeddedPreview, { props: { error: 'long' } });
    const error = component.locator('[data-browser-load-error]');
    const retry = error.getByRole('button', { name: 'Retry', exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    await expect(retry).toBeInViewport();
    const overflow = await error.evaluate((element) => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await testInfo.attach(`narrow-preview-error-${theme}`, {
      body: await component.screenshot(),
      contentType: 'image/png',
    });
    await retry.press('Enter');
    await expect(error).toHaveCount(0);
    await expect(component.getByRole('button', { name: 'Refresh page' })).toBeFocused();
  });
}

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
  await expect(page.getByRole('tooltip')).toContainText('office-linux');
  await testInfo.attach('browser-host-tooltip', {
    body: await page.screenshot(),
    contentType: 'image/png',
  });
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
