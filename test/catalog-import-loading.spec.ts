import { expect, test } from '@playwright/test';

const baseUrl = process.env.UI_PREVIEW_BASE_URL;
test.skip(!baseUrl, 'Set UI_PREVIEW_BASE_URL to an isolated UI preview server.');

for (const [kind, path, ready] of [
  [
    'named',
    '/sandbox/button?state=default&theme=light&motion=reduced',
    '[data-preview-ready=true]',
  ],
  [
    'legacy',
    '/sandbox/button?theme=light&motion=reduced',
    '[data-catalog-preview="button"] button',
  ],
] as const) {
  test(`${kind} Button loads no unrelated chat, editor or overlay renderer families`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const unrelated: string[] = [];
    const failures: string[] = [];
    page.on('request', (request) => {
      if (
        /ChatPolish|ProposalCatalogPreview|OverlayCatalogPreview|ChoiceCatalogPreview|tiptap|prosemirror|highlight\.js|diff-editor/i.test(
          request.url(),
        )
      ) {
        unrelated.push(request.url());
      }
    });
    page.on('requestfailed', (request) => failures.push(request.url()));
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' });
    await page.locator(ready).first().waitFor({ state: 'visible', timeout: 60_000 });
    if (kind === 'legacy') {
      await page.getByRole('button', { name: '1. Primary', exact: true }).click();
      await expect(page.getByLabel('Button click count', { exact: true })).toHaveText('1');
    }
    expect(unrelated).toEqual([]);
    expect(failures).toEqual([]);
  });
}

test('named scene state navigation updates content and history without a document reload', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const documents: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url());
  });
  await page.goto(`${baseUrl}/sandbox/button?state=default&motion=reduced`);
  await page.locator('[data-preview-ready=true]').waitFor({ timeout: 60_000 });
  await page.evaluate(() => {
    (window as Window & { navigationProbe?: string }).navigationProbe = 'preserved';
  });
  await page.getByRole('link', { name: 'destructive', exact: true }).click();
  await expect(page.locator('[data-preview-ready=true]')).toHaveAttribute(
    'data-preview-state',
    'destructive',
  );
  await expect(page.getByRole('button', { name: 'Delete workspace', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { navigationProbe?: string }).navigationProbe),
  ).toBe('preserved');
  expect(documents).toHaveLength(1);
  await page.goBack();
  await expect(page.locator('[data-preview-ready=true]')).toHaveAttribute(
    'data-preview-state',
    'default',
  );
  expect(documents).toHaveLength(1);
});
