import { expect, test } from '../../../test/ct-test';
import Harness from './__tests__/DockRecencyBrowserHarness.svelte';

for (const unavailable of [false, true]) {
  test(`dock production recency boundary: ${unavailable ? 'unavailable index' : 'human conversations'}`, async ({
    mount,
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 720, height: 760 });
    await page.clock.setFixedTime(new Date('2026-10-19T12:00:00.000Z'));
    await mount(Harness, { props: { unavailable } });
    const host = page.getByTestId('dock-recency-boundary');
    const requests = async (): Promise<
      Array<{
        method: string;
        params: { scope?: string; previewChars?: number; workspaceId?: string; limit?: number };
      }>
    > => JSON.parse((await host.getAttribute('data-requests'))!);
    await expect
      .poll(
        async () =>
          (await requests()).filter(({ method }) => method === 'agent.listUserMessages').length,
      )
      .toBe(7);
    const expectedIds = unavailable
      ? []
      : ['dock-preview-workspace-52', 'dock-preview-workspace-51', 'dock-preview-workspace-53'];
    await expect(host).toHaveAttribute('data-visible-ids', JSON.stringify(expectedIds));
    await expect(host.locator('button[data-workspace-id]')).toHaveCount(expectedIds.length);
    const assistant = host.locator('[data-dock-assistant]');
    await assistant.focus();
    await expect(assistant).toBeVisible();
    const calls = await requests();
    expect(
      new Set(
        calls.filter(({ method }) => method === 'agent.list').map(({ params }) => params.scope),
      ),
    ).toEqual(new Set(['topLevel', 'delegated', 'background']));
    for (const { params } of calls.filter(({ method }) => method === 'agent.listUserMessages')) {
      expect(params.workspaceId).toBeTruthy();
      expect(params.previewChars).toBe(80);
      expect(params.limit).toBe(50);
    }
    await testInfo.attach('dock-recency-boundary.json', {
      body: JSON.stringify(
        {
          clock: '2026-10-19T12:00:00.000Z',
          unavailable,
          visibleWorkspaceIds: expectedIds,
          requests: calls,
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
    const screenshot = testInfo.outputPath('dock-recency-boundary.png');
    await host.screenshot({ path: screenshot, animations: 'disabled' });
    await testInfo.attach('dock-recency-boundary.png', {
      path: screenshot,
      contentType: 'image/png',
    });
  });
}
